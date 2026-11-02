import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL no definida.");
}

const parsed = new URL(url);
const database = decodeURIComponent(
  parsed.pathname.replace(/^\/+/, "")
);

if (database !== "pos_novnix") {
  throw new Error("Base de datos no autorizada.");
}

parsed.searchParams.set(
  "options",
  [
    parsed.searchParams.get("options"),
    "-c default_transaction_read_only=on"
  ].filter(Boolean).join(" ")
);

process.env.DATABASE_URL = parsed.toString();

test("M14: autorizacion HTTP real y solo lectura", async t => {
  const { app } = await import("../../../app.ts");
  const { prisma } = await import("../../../lib/prisma.ts");
  const { tokenService } =
    await import("../../auth/token.service.ts");

  let server;

  try {
    const connection = await prisma.$queryRaw`
      SELECT
        current_database() AS database,
        current_setting(
          'default_transaction_read_only'
        ) AS readonly
    `;

    assert.equal(connection[0]?.database, "pos_novnix");
    assert.equal(connection[0]?.readonly, "on");

    const before = await prisma.auditoria.count();

    const event = await prisma.auditoria.findFirst({
      where: {
        tabla: {
          in: ["venta", "devolucion_venta"]
        }
      },
      select: {
        id: true,
        usuario: {
          select: {
            empresa_id: true
          }
        }
      },
      orderBy: [
        { creado_en: "desc" },
        { id: "desc" }
      ]
    });

    assert.ok(event?.usuario);

    const companyId = event.usuario.empresa_id;

    const adminPermission = {
      rol: {
        codigo: "ADMIN",
        activo: true,
        rol_permiso: {
          some: {
            permiso: {
              codigo: "AUDITORIA.VER"
            }
          }
        }
      }
    };

    const admin = await prisma.usuario.findFirst({
      where: {
        empresa_id: companyId,
        activo: true,
        bloqueado: false,
        empresa: { activo: true },
        usuario_rol: {
          some: adminPermission
        }
      },
      select: {
        id: true,
        empresa_id: true
      }
    });

    assert.ok(
      admin,
      "No existe un ADMIN activo con AUDITORIA.VER."
    );

    const adminToken =
      await tokenService.createAccessToken({
        userId: admin.id,
        empresaId: admin.empresa_id
      });

    server = app.listen(0, "127.0.0.1");

    await once(server, "listening");

    const address = server.address();

    assert.ok(address && typeof address !== "string");

    const base =
      `http://127.0.0.1:${address.port}`;

    async function request(path, token, method = "GET") {
      const response = await fetch(base + path, {
        method,
        headers: token
          ? { Authorization: `Bearer ${token}` }
          : {},
        signal: AbortSignal.timeout(10000)
      });

      const contentType =
        response.headers.get("content-type") ?? "";

      const body = contentType.includes("application/json")
        ? await response.json()
        : null;

      return {
        status: response.status,
        body
      };
    }

    let firstEventId = null;
    let firstEventTable = null;
    let firstEventAction = null;

    await t.test("ADMIN: listado HTTP 200", async () => {
      const result = await request(
        "/api/v1/audit-logs?limit=100",
        adminToken
      );

      assert.equal(result.status, 200);
      assert.equal(result.body?.ok, true);
      assert.ok(Array.isArray(result.body.data));
      assert.ok(result.body.data.length > 0);

      firstEventId = result.body.data[0].id;
      firstEventTable = result.body.data[0].tabla;
      firstEventAction = result.body.data[0].accion;

      console.log({
        eventos_visibles: result.body.data.length,
        total: result.body.pagination.total
      });
    });

    await t.test("ADMIN: detalle HTTP 200", async () => {
      const result = await request(
        `/api/v1/audit-logs/${firstEventId}`,
        adminToken
      );

      assert.equal(result.status, 200);
      assert.equal(result.body?.ok, true);
      assert.equal(result.body.data.id, firstEventId);

      assert.equal(
        "ip_origen" in result.body.data,
        false
      );

      const payload = result.body.data.datos_nuevos;

      if (payload !== null) {
        assert.equal("password_hash" in payload, false);
        assert.equal("token" in payload, false);
        assert.equal("access_token" in payload, false);
      }
    });

    await t.test("Filtros de tabla y accion", async () => {
      const query = new URLSearchParams({
        tabla: firstEventTable,
        accion: firstEventAction,
        limit: "100"
      });

      const result = await request(
        `/api/v1/audit-logs?${query}`,
        adminToken
      );

      assert.equal(result.status, 200);
      assert.equal(result.body.ok, true);

      assert.ok(
        result.body.data.every(
          row =>
            row.tabla === firstEventTable &&
            row.accion === firstEventAction
        )
      );
    });

    await t.test("Paginacion HTTP", async () => {
      const first = await request(
        "/api/v1/audit-logs?page=1&limit=1",
        adminToken
      );

      const second = await request(
        "/api/v1/audit-logs?page=2&limit=1",
        adminToken
      );

      assert.equal(first.status, 200);
      assert.equal(second.status, 200);

      assert.equal(first.body.data.length, 1);
      assert.equal(second.body.data.length, 1);

      assert.notEqual(
        first.body.data[0].id,
        second.body.data[0].id
      );
    });

    await t.test("Limite invalido HTTP 400", async () => {
      const result = await request(
        "/api/v1/audit-logs?limit=101",
        adminToken
      );

      assert.equal(result.status, 400);
      assert.equal(result.body?.ok, false);
    });

    await t.test("Fechas invertidas HTTP 400", async () => {
      const result = await request(
        "/api/v1/audit-logs?fecha_desde=2026-11-02&fecha_hasta=2026-10-01",
        adminToken
      );

      assert.equal(result.status, 400);
    });

    await t.test("ID invalido HTTP 400", async () => {
      const result = await request(
        "/api/v1/audit-logs/abc",
        adminToken
      );

      assert.equal(result.status, 400);
    });

    await t.test("Evento inexistente HTTP 404", async () => {
      const result = await request(
        "/api/v1/audit-logs/9223372036854775807",
        adminToken
      );

      assert.equal(result.status, 404);
    });

    await t.test(
      "JWT con empresa manipulada HTTP 401",
      async () => {
        const forgedToken =
          await tokenService.createAccessToken({
            userId: admin.id,
            empresaId: 0n
          });

        const result = await request(
          "/api/v1/audit-logs",
          forgedToken
        );

        assert.equal(result.status, 401);
      }
    );

    const withoutPermission =
      await prisma.usuario.findFirst({
        where: {
          empresa_id: companyId,
          activo: true,
          bloqueado: false,
          empresa: { activo: true },
          usuario_rol: {
            none: {
              rol: {
                activo: true,
                rol_permiso: {
                  some: {
                    permiso: {
                      codigo: "AUDITORIA.VER"
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

    if (withoutPermission) {
      await t.test(
        "Usuario real sin permiso HTTP 403",
        async () => {
          const token =
            await tokenService.createAccessToken({
              userId: withoutPermission.id,
              empresaId: withoutPermission.empresa_id
            });

          const result = await request(
            "/api/v1/audit-logs",
            token
          );

          assert.equal(result.status, 403);
          assert.equal(result.body?.ok, false);
        }
      );
    } else {
      console.log(
        "PENDIENTE: no se encontro usuario activo sin AUDITORIA.VER."
      );
    }

    const foreignAdmin =
      await prisma.usuario.findFirst({
        where: {
          empresa_id: { not: companyId },
          activo: true,
          bloqueado: false,
          empresa: { activo: true },
          usuario_rol: {
            some: adminPermission
          }
        },
        select: {
          id: true,
          empresa_id: true
        }
      });

    if (foreignAdmin) {
      await t.test(
        "ADMIN de otra empresa HTTP 404",
        async () => {
          const token =
            await tokenService.createAccessToken({
              userId: foreignAdmin.id,
              empresaId: foreignAdmin.empresa_id
            });

          const result = await request(
            `/api/v1/audit-logs/${firstEventId}`,
            token
          );

          assert.equal(result.status, 404);
        }
      );
    } else {
      console.log(
        "PENDIENTE: no hay ADMIN autorizado de otra empresa."
      );
    }

    await t.test("DELETE no habilitado HTTP 404", async () => {
      const result = await request(
        `/api/v1/audit-logs/${firstEventId}`,
        adminToken,
        "DELETE"
      );

      assert.equal(result.status, 404);
    });

    await t.test("Historial sin modificaciones", async () => {
      const after = await prisma.auditoria.count();

      assert.equal(after, before);

      console.log({
        eventos_antes: before,
        eventos_despues: after,
        historial_conservado: true
      });
    });

  } finally {
    if (server) {
      server.closeAllConnections();

      await new Promise((resolve, reject) => {
        server.close(error => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    await prisma.$disconnect();
  }
});
