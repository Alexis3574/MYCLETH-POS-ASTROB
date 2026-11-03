import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

const url = process.env.DATABASE_URL;
if (!url || new URL(url).pathname !== "/pos_novnix") {
  throw new Error("Solo se permite pos_novnix.");
}

test("M15: actualización y seguridad final", async t => {
  const { app } = await import("../../app.ts");
  const { prisma } = await import("../../lib/prisma.ts");
  const { tokenService } =
    await import("../auth/token.service.ts");
  const { settingKeys } =
    await import("./company-settings.schema.ts");

  let server;

  try {
    const identity = await prisma.$queryRaw`
      SELECT current_database() AS database
    `;
    assert.equal(identity[0].database, "pos_novnix");

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
      select: { id: true, empresa_id: true }
    });

    assert.ok(admin, "ADMIN autorizado no encontrado.");

    const token = await tokenService.createAccessToken({
      userId: admin.id,
      empresaId: admin.empresa_id
    });

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const prefix = "/api/v1/company-settings";
    const base = `http://127.0.0.1:${address.port}`;

    async function request(path, {
      method = "GET",
      auth = token,
      body
    } = {}) {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(auth
            ? { Authorization: `Bearer ${auth}` }
            : {}),
          ...(body === undefined
            ? {}
            : { "Content-Type": "application/json" })
        },
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10000)
      });

      return {
        status: response.status,
        body: await response.json()
      };
    }

    const original = await prisma.configuracion_empresa.findFirst({
      where: {
        empresa_id: admin.empresa_id,
        clave: { in: [...settingKeys] }
      },
      orderBy: { id: "asc" }
    });

    assert.ok(
      original,
      "No existe configuración creada en la etapa 3B."
    );

    const key = original.clave;
    const initialValue = structuredClone(original.valor);
    const modified = structuredClone(initialValue);

    const booleanField = Object.keys(modified).find(
      field => typeof modified[field] === "boolean"
    );

    assert.ok(booleanField);

    modified[booleanField] = !modified[booleanField];

    const path = `${prefix}/${key}`;

    const auditBefore = await prisma.auditoria.count();
    const newestBefore = await prisma.auditoria.aggregate({
      _max: { id: true }
    });

    await t.test("PUT sin JWT: HTTP 401", async () => {
      const result = await request(path, {
        method: "PUT",
        auth: null,
        body: { valor: modified }
      });

      assert.equal(result.status, 401);
    });

    await t.test("PUT con empresa manipulada: HTTP 401", async () => {
      const forged = await tokenService.createAccessToken({
        userId: admin.id,
        empresaId: 0n
      });

      const result = await request(path, {
        method: "PUT",
        auth: forged,
        body: { valor: modified }
      });

      assert.equal(result.status, 401);
    });

    await t.test("PUT con campo prohibido: HTTP 400", async () => {
      const result = await request(path, {
        method: "PUT",
        body: {
          empresa_id: "999",
          valor: modified
        }
      });

      assert.equal(result.status, 400);
    });

    const unauthorized = await prisma.usuario.findFirst({
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
      select: { id: true, empresa_id: true }
    });

    await t.test("PUT sin permiso: HTTP 403", async st => {
      if (!unauthorized) {
        st.skip("No existe usuario sin permiso.");
        return;
      }

      const otherToken =
        await tokenService.createAccessToken({
          userId: unauthorized.id,
          empresaId: unauthorized.empresa_id
        });

      const result = await request(path, {
        method: "PUT",
        auth: otherToken,
        body: { valor: modified }
      });

      assert.equal(result.status, 403);
    });

    await t.test("Rechazos no crean auditorías", async () => {
      assert.equal(
        await prisma.auditoria.count(),
        auditBefore
      );
    });

    await t.test("UPDATE, auditoría y restauración", async () => {
      let changed = false;

      try {
        const response = await request(path, {
          method: "PUT",
          body: { valor: modified }
        });

        changed = response.status === 200;

        assert.equal(response.status, 200);
        assert.equal(response.body.ok, true);
        assert.equal(response.body.data.id, original.id.toString());
        assert.deepEqual(response.body.data.valor, modified);

        const saved = await prisma.configuracion_empresa.findUnique({
          where: {
            empresa_id_clave: {
              empresa_id: admin.empresa_id,
              clave: key
            }
          }
        });

        assert.deepEqual(saved.valor, modified);

        const audit = await prisma.auditoria.findFirst({
          where: {
            tabla: "configuracion_empresa",
            registro_id: original.id,
            usuario_id: admin.id,
            accion: "UPDATE",
            id: {
              gt: newestBefore._max.id ?? 0n
            }
          },
          orderBy: { id: "desc" }
        });

        assert.ok(audit, "Evento UPDATE no encontrado.");

        assert.equal(
          await prisma.auditoria.count(),
          auditBefore + 1
        );

        const detail = await request(
          `/api/v1/audit-logs/${audit.id}`
        );

        assert.equal(detail.status, 200);
        assert.equal(detail.body.data.tabla, "configuracion_empresa");
        assert.equal(detail.body.data.sucursal_id, null);
        assert.deepEqual(detail.body.data.datos_nuevos, {
          clave: key,
          operacion: "ACTUALIZAR"
        });

        console.log({
          categoria: key,
          campo_actualizado: booleanField,
          evento_update: audit.id.toString(),
          resultado: "PASS"
        });
      } finally {
        if (changed) {
          const restored = await request(path, {
            method: "PUT",
            body: { valor: initialValue }
          });

          assert.equal(
            restored.status,
            200,
            "No se pudo restaurar la configuración."
          );

          const record =
            await prisma.configuracion_empresa.findUnique({
              where: {
                empresa_id_clave: {
                  empresa_id: admin.empresa_id,
                  clave: key
                }
              }
            });

          assert.deepEqual(record.valor, initialValue);

          console.log("Valor original restaurado.");
        }
      }
    });

    console.log({
      auditorias_antes: auditBefore,
      auditorias_despues: await prisma.auditoria.count(),
      empresa: admin.empresa_id.toString()
    });

  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve =>
        server.close(resolve)
      );
    }

    await prisma.$disconnect();
  }
});
