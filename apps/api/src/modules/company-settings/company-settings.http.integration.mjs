import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL no definida.");
}

const database = decodeURIComponent(
  new URL(databaseUrl).pathname.replace(/^\/+/, "")
);

if (database !== "pos_novnix") {
  throw new Error("Base de datos no autorizada.");
}

test("M15: integración HTTP y Prisma", async t => {
  const { app } = await import("../../app.ts");
  const { prisma } = await import("../../lib/prisma.ts");
  const { tokenService } =
    await import("../auth/token.service.ts");
  const {
    settingKeys,
    settingDefaults
  } = await import("./company-settings.schema.ts");

  let server;

  try {
    const identity = await prisma.$queryRaw`
      SELECT current_database() AS database
    `;

    assert.equal(identity[0]?.database, "pos_novnix");

    const admin = await prisma.usuario.findFirst({
      where: {
        activo: true,
        bloqueado: false,
        empresa: { activo: true },
        usuario_rol: {
          some: {
            rol: {
              codigo: "ADMIN",
              activo: true,
              rol_permiso: {
                some: {
                  permiso: {
                    codigo: "CONFIGURACION.GESTIONAR"
                  }
                }
              }
            }
          }
        }
      },
      select: {
        id: true,
        empresa_id: true
      }
    });

    assert.ok(
      admin,
      "No existe ADMIN activo con permiso de configuración."
    );

    const token = await tokenService.createAccessToken({
      userId: admin.id,
      empresaId: admin.empresa_id
    });

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();

    assert.ok(
      address && typeof address !== "string"
    );

    const base =
      `http://127.0.0.1:${address.port}`;

    async function request(
      route,
      {
        auth = token,
        method = "GET",
        body
      } = {}
    ) {
      const response = await fetch(base + route, {
        method,
        headers: {
          ...(auth
            ? { Authorization: `Bearer ${auth}` }
            : {}),
          ...(body !== undefined
            ? { "Content-Type": "application/json" }
            : {})
        },
        ...(body !== undefined
          ? { body: JSON.stringify(body) }
          : {}),
        signal: AbortSignal.timeout(10000)
      });

      return {
        status: response.status,
        body: await response.json()
      };
    }

    const prefix = "/api/v1/company-settings";

    await t.test("Sin JWT: HTTP 401", async () => {
      const response = await request(prefix, {
        auth: null
      });

      assert.equal(response.status, 401);
    });

    await t.test("JWT inválido: HTTP 401", async () => {
      const response = await request(prefix, {
        auth: "token.invalido"
      });

      assert.equal(response.status, 401);
    });

    await t.test("ADMIN: listado HTTP 200", async () => {
      const response = await request(prefix);

      assert.equal(response.status, 200);
      assert.equal(response.body?.ok, true);
      assert.equal(response.body.data.length, 4);

      assert.deepEqual(
        response.body.data.map(row => row.clave),
        settingKeys
      );
    });

    await t.test("Categoría inválida: HTTP 400", async () => {
      const response = await request(
        `${prefix}/categoria_desconocida`
      );

      assert.equal(response.status, 400);
    });

    await t.test("Valor inválido: HTTP 400", async () => {
      const response = await request(
        `${prefix}/ventas`,
        {
          method: "PUT",
          body: {
            valor: {
              parametro_desconocido: true
            }
          }
        }
      );

      assert.equal(response.status, 400);
    });

    await t.test("Empresa manipulada: HTTP 401", async () => {
      const invalidCompanyToken =
        await tokenService.createAccessToken({
          userId: admin.id,
          empresaId: 0n
        });

      const response = await request(prefix, {
        auth: invalidCompanyToken
      });

      assert.equal(response.status, 401);
    });

    const userWithoutPermission =
      await prisma.usuario.findFirst({
        where: {
          empresa_id: admin.empresa_id,
          activo: true,
          bloqueado: false,
          usuario_rol: {
            none: {
              rol: {
                activo: true,
                rol_permiso: {
                  some: {
                    permiso: {
                      codigo: "CONFIGURACION.GESTIONAR"
                    }
                  }
                }
              }
            }
          }
        },
        select: {
          id: true,
          empresa_id: true
        }
      });

    if (userWithoutPermission) {
      await t.test(
        "Usuario sin permiso: HTTP 403",
        async () => {
          const userToken =
            await tokenService.createAccessToken({
              userId: userWithoutPermission.id,
              empresaId: userWithoutPermission.empresa_id
            });

          const response = await request(prefix, {
            auth: userToken
          });

          assert.equal(response.status, 403);
        }
      );
    } else {
      console.log(
        "PENDIENTE: no existe usuario activo sin permiso."
      );
    }

    const existing = await prisma.configuracion_empresa.findMany({
      where: {
        empresa_id: admin.empresa_id,
        clave: { in: [...settingKeys] }
      },
      select: { clave: true }
    });

    const existingKeys =
      new Set(existing.map(row => row.clave));

    const availableKey = settingKeys.find(
      key => !existingKeys.has(key)
    );

    if (availableKey) {
      await t.test(
        "PUT real: persistencia y auditoría M14",
        async () => {
          const before = await prisma.auditoria.count();

          const response = await request(
            `${prefix}/${availableKey}`,
            {
              method: "PUT",
              body: {
                valor: settingDefaults[availableKey]
              }
            }
          );

          assert.equal(response.status, 200);
          assert.equal(response.body?.ok, true);
          assert.equal(
            response.body.data.clave,
            availableKey
          );
          assert.equal(
            response.body.data.personalizado,
            true
          );

          const saved =
            await prisma.configuracion_empresa.findUnique({
              where: {
                empresa_id_clave: {
                  empresa_id: admin.empresa_id,
                  clave: availableKey
                }
              }
            });

          assert.ok(saved);

          assert.deepEqual(
            saved.valor,
            settingDefaults[availableKey]
          );

          const audit = await prisma.auditoria.findFirst({
            where: {
              tabla: "configuracion_empresa",
              registro_id: saved.id,
              usuario_id: admin.id
            },
            orderBy: { id: "desc" }
          });

          assert.ok(audit);
          assert.equal(audit.accion, "INSERT");

          const after = await prisma.auditoria.count();

          assert.equal(after, before + 1);

          const detail = await request(
            `/api/v1/audit-logs/${audit.id}`
          );

          assert.equal(detail.status, 200);
          assert.equal(detail.body?.ok, true);
          assert.equal(
            detail.body.data.tabla,
            "configuracion_empresa"
          );

          const readBack = await request(
            `${prefix}/${availableKey}`
          );

          assert.equal(readBack.status, 200);
          assert.equal(
            readBack.body.data.personalizado,
            true
          );

          console.log({
            categoria: availableKey,
            configuracion_guardada: true,
            auditoria_m14: audit.id.toString(),
            eventos_antes: before,
            eventos_despues: after
          });
        }
      );
    } else {
      console.log(
        "PENDIENTE: todas las categorías ya tienen valores. " +
        "No se sobrescriben configuraciones existentes."
      );
    }

    console.log("\nM15: PRUEBAS HTTP FINALIZADAS");

  } finally {
    if (server) {
      server.closeAllConnections();

      await new Promise(resolve => {
        server.close(() => resolve());
      });
    }

    await prisma.$disconnect();
  }
});
