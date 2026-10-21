import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { hash } from "bcryptjs";
import dotenv from "dotenv";

import {
  createFixture,
  deleteFixture,
  testRuntime,
} from "../transfers/support/database-fixture.js";

dotenv.config({ quiet: true });

const connection = process.env.DATABASE_URL;

if (!connection) {
  throw new Error("DATABASE_URL no configurada.");
}

const url = new URL(connection);

if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  (url.port && url.port !== "5432") ||
  url.pathname !== "/pos_novnix"
) {
  throw new Error("Base de datos no autorizada.");
}

const base = "http://127.0.0.1:3000";

process.env.TRANSFERS_TEST_DATABASE_URL = connection;
process.env.TRANSFERS_ALLOW_DB_TESTS = "true";
process.env.POS_ALLOW_TEST_DB = "SI";
process.env.INVENTORY_SYNC_ENABLED = "false";

const password = randomBytes(24).toString("base64url");
const passwordHash = await hash(password, 10);

let runtime: Awaited<ReturnType<typeof testRuntime>> | undefined;
let fixtures: {
  main: Awaited<ReturnType<typeof createFixture>>;
  foreign: Awaited<ReturnType<typeof createFixture>>;
  viewerId: bigint;
  viewerRoleId: bigint;
} | undefined;

let activeChild: ReturnType<typeof spawn> | undefined;

process.on("SIGINT", () => {
  console.error("\n[INTERRUPCION] Deteniendo prueba y preparando limpieza.");
  activeChild?.kill("SIGINT");
  process.exitCode = 130;
});

async function login(empresaId: bigint, username: string, userId: bigint) {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      empresa_id: empresaId.toString(),
      username,
      password,
    }),
    signal: AbortSignal.timeout(15000),
  });

  assert.equal(response.status, 200, `Login de ${username}: HTTP ${response.status}`);

  const result = await response.json();
  const token = result.data?.access_token;

  assert.ok(token, "JWT no recibido.");

  const me = await fetch(`${base}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });

  assert.equal(me.status, 200);

  const profile = await me.json();

  assert.equal(profile.data?.id, userId.toString());
  assert.equal(profile.data?.empresa?.id, empresaId.toString());

  return token as string;
}

async function execute(file: string, env: Record<string, string>) {
  console.log(`\n========== ${file} ==========`);

  const result = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [file], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: "inherit",
    });

    activeChild = child;

    child.once("error", reject);
    child.once("close", (code) => {
      activeChild = undefined;
      resolve(code ?? 1);
    });
  });

  console.log(result === 0 ? "[APROBADO] Script finalizado." : "[FALLIDO] Script HTTP.");

  return result;
}

try {
  runtime = await testRuntime();

  console.log("[OK] PostgreSQL: pos_novnix");

  fixtures = await runtime.prisma.$transaction(async (tx) => {
    const main = await createFixture(tx);
    const foreign = await createFixture(tx);

    const ver = await tx.permiso.findUniqueOrThrow({
      where: { codigo: "INVENTARIO.VER" },
    });

    const ajustar = await tx.permiso.findUniqueOrThrow({
      where: { codigo: "INVENTARIO.AJUSTAR" },
    });

    await tx.rol_permiso.createMany({
      data: [
        { rol_id: main.roleId, permiso_id: ver.id },
        { rol_id: main.roleId, permiso_id: ajustar.id },
        { rol_id: foreign.roleId, permiso_id: ver.id },
      ],
    });

    await tx.usuario.update({
      where: { id: main.actor.userId },
      data: { password_hash: passwordHash },
    });

    await tx.usuario.update({
      where: { id: foreign.actor.userId },
      data: { password_hash: passwordHash },
    });

    const viewerRole = await tx.rol.create({
      data: {
        codigo: `HTTP-READ-${randomUUID()}`,
        nombre: "Consulta HTTP temporal",
        rol_permiso: {
          create: { permiso_id: ver.id },
        },
      },
    });

    const viewer = await tx.usuario.create({
      data: {
        empresa_id: main.actor.empresaId,
        username: `http_read_${randomUUID().slice(0, 12)}`,
        nombre: "Consulta HTTP",
        password_hash: passwordHash,
      },
    });

    await tx.usuario_rol.create({
      data: {
        usuario_id: viewer.id,
        rol_id: viewerRole.id,
      },
    });

    return {
      main,
      foreign,
      viewerId: viewer.id,
      viewerRoleId: viewerRole.id,
    };
  }, { timeout: 60000 });

  console.log("[OK] Empresas, almacenes, productos y usuarios sintéticos creados.");

  const f = fixtures;

  const users = await runtime.prisma.usuario.findMany({
    where: {
      id: {
        in: [f.main.actor.userId, f.foreign.actor.userId, f.viewerId],
      },
    },
    select: { id: true, empresa_id: true, username: true },
  });

  const byId = (id: bigint) => {
    const user = users.find((item) => item.id === id);
    assert.ok(user);
    return user;
  };

  const mainUser = byId(f.main.actor.userId);
  const foreignUser = byId(f.foreign.actor.userId);
  const viewerUser = byId(f.viewerId);

  const mainToken = await login(
    mainUser.empresa_id, mainUser.username, mainUser.id
  );

  const foreignToken = await login(
    foreignUser.empresa_id, foreignUser.username, foreignUser.id
  );

  const viewerToken = await login(
    viewerUser.empresa_id, viewerUser.username, viewerUser.id
  );

  console.log("[OK] Tres JWT obtenidos y verificados mediante Express.");
  console.log("[OK] Identidad, empresa y autenticación coinciden.");

  const inventoryStatus = await execute(
    "tests/inventory/test-inventory-http.mjs",
    {
      INVENTORY_API_URL: base,
      INVENTORY_READ_TOKEN: mainToken,
      INVENTORY_ADJUST_TOKEN: mainToken,
      INVENTORY_DENIED_ADJUST_TOKEN: viewerToken,
      INVENTORY_WAREHOUSE_ID: f.main.originId.toString(),
      INVENTORY_PRODUCT_ID: f.main.products[0]!.toString(),
      INVENTORY_FOREIGN_WAREHOUSE_ID: f.foreign.originId.toString(),
      INVENTORY_FOREIGN_PRODUCT_ID: f.foreign.products[0]!.toString(),
    }
  );

  const transfersStatus = await execute(
    "tests/transfers/test-transfers-http.mjs",
    {
      TRANSFERS_HTTP_TEST_ENABLED: "true",
      TRANSFERS_HTTP_ISOLATED_ENVIRONMENT: "true",
      TRANSFERS_HTTP_API_URL: base,
      TRANSFERS_HTTP_TOKEN: mainToken,
      TRANSFERS_HTTP_READ_ONLY_TOKEN: viewerToken,
      TRANSFERS_HTTP_OTHER_COMPANY_TOKEN: foreignToken,
      TRANSFERS_HTTP_BODY_JSON: JSON.stringify({
        almacen_origen_id: f.main.originId.toString(),
        almacen_destino_id: f.main.destinationId.toString(),
        detalles: [
          {
            producto_id: f.main.products[0]!.toString(),
            cantidad: "1.000",
          },
        ],
      }),
    }
  );

  if (inventoryStatus !== 0 || transfersStatus !== 0) {
    process.exitCode = 1;
    console.error("[ERROR] Una o más pruebas HTTP no terminaron correctamente.");
  } else {
    console.log("\n[OK] Ambos scripts HTTP finalizaron sin errores.");
  }

} catch (error) {
  process.exitCode = 1;
  console.error("[ERROR]", error instanceof Error ? error.message : String(error));
} finally {
  if (runtime) {
    try {
      if (fixtures) {
        const f = fixtures;

        await runtime.prisma.$transaction(async (tx) => {
          await tx.usuario_rol.deleteMany({
            where: { usuario_id: f.viewerId },
          });

          await tx.usuario.delete({
            where: { id: f.viewerId },
          });

          await tx.rol.delete({
            where: { id: f.viewerRoleId },
          });

          await deleteFixture(tx, f.foreign);
          await deleteFixture(tx, f.main);
        }, { timeout: 60000 });

        console.log("[OK] Usuarios, roles y datos sintéticos eliminados.");
      }
    } catch (error) {
      process.exitCode = 1;
      console.error(
        "[ERROR] Limpieza incompleta:",
        error instanceof Error ? error.message : String(error)
      );
      console.error("Revisar los registros sintéticos antes de repetir la prueba.");
    } finally {
      await runtime.prisma.$disconnect();
    }
  }
}
