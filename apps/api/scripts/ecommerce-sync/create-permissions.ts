import "dotenv/config";
import { prisma } from "../../src/lib/prisma.js";

const CODE = "ECOMMERCE_SYNC.VER";
const MODULE = "ECOMMERCE_SYNC";
const DESCRIPTION =
  "Consultar eventos, historial, estados y diagnósticos de sincronización Ecommerce";

async function main() {
  const mode = process.argv[2];

  if (mode !== "--check" && mode !== "--apply") {
    throw new Error("Utilice --check o --apply.");
  }

  const url = new URL(process.env.DATABASE_URL ?? "");

  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    decodeURIComponent(url.pathname) !== "/pos_novnix" ||
    (url.port && url.port !== "5432") ||
    url.searchParams.get("schema") !== "pos"
  ) {
    throw new Error("BLOQUEADO: destino PostgreSQL no autorizado.");
  }

  const existing = await prisma.permiso.findUnique({
    where: { codigo: CODE },
    select: {
      id: true,
      codigo: true,
      modulo: true,
      descripcion: true
    }
  });

  if (existing && existing.modulo !== MODULE) {
    throw new Error("Conflicto: permiso existente con otro módulo.");
  }

  console.log("Base: pos_novnix");
  console.log("Esquema: pos");
  console.log("Permiso:", CODE);
  console.log("Modo:", mode);

  if (mode === "--check") {
    console.log(JSON.stringify({
      ok: true,
      existe: Boolean(existing),
      id: existing?.id.toString() ?? null,
      modificaciones: 0
    }, null, 2));
    return;
  }

  const result = await prisma.$transaction(async tx => {
    const permission = await tx.permiso.upsert({
      where: { codigo: CODE },
      update: {},
      create: {
        codigo: CODE,
        modulo: MODULE,
        descripcion: DESCRIPTION
      },
      select: {
        id: true,
        codigo: true,
        modulo: true
      }
    });

    const assignments = await tx.rol_permiso.count({
      where: { permiso_id: permission.id }
    });

    return {
      id: permission.id.toString(),
      codigo: permission.codigo,
      modulo: permission.modulo,
      asignaciones_roles: assignments
    };
  });

  console.log(JSON.stringify({
    ok: true,
    permiso: result
  }, null, 2));

  console.log("PASS: registro completado.");
  console.log("No se modificaron roles ni eventos Ecommerce.");
}

main()
  .catch(error => {
    console.error("ERROR:", error instanceof Error
      ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
