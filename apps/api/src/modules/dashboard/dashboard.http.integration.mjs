import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

const databaseUrl = process.env.DATABASE_URL;

if (
  !databaseUrl ||
  decodeURIComponent(
    new URL(databaseUrl).pathname.replace(/^\/+/, "")
  ) !== "pos_novnix"
) {
  throw new Error("Solo se permite pos_novnix.");
}

test("M16: integración HTTP, finanzas y seguridad", async t => {
  const { app } = await import("../../app.ts");
  const { prisma } = await import("../../lib/prisma.ts");
  const { Prisma } = await import(
    "../../generated/prisma/client.ts"
  );
  const { tokenService } = await import(
    "../auth/token.service.ts"
  );

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
                  permiso: { codigo: "DASHBOARD.VER" }
                }
              }
            }
          }
        }
      },
      select: {
        id: true,
        empresa_id: true,
        empresa: {
          select: {
            moneda: true,
            zona_horaria: true
          }
        }
      }
    });

    assert.ok(admin, "No existe ADMIN con DASHBOARD.VER.");

    const branch = await prisma.sucursal.findFirst({
      where: {
        empresa_id: admin.empresa_id,
        activo: true
      },
      select: { id: true }
    });

    assert.ok(branch, "No hay sucursal activa.");

    const token = await tokenService.createAccessToken({
      userId: admin.id,
      empresaId: admin.empresa_id
    });

    const initialCounts = {
      auditorias: await prisma.auditoria.count(),
      ventas: await prisma.venta.count(),
      devoluciones: await prisma.devolucion_venta.count()
    };

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const base = `http://127.0.0.1:${address.port}`;
    const prefix = "/api/v1/dashboard/summary";

    async function request(path, auth = token) {
      const response = await fetch(base + path, {
        headers: auth
          ? { Authorization: `Bearer ${auth}` }
          : {},
        signal: AbortSignal.timeout(15000)
      });

      return {
        status: response.status,
        body: await response.json()
      };
    }

    await t.test("Sin JWT: HTTP 401", async () => {
      const result = await request(prefix, null);
      assert.equal(result.status, 401);
    });

    await t.test("JWT inválido: HTTP 401", async () => {
      const result = await request(prefix, "token.invalido");
      assert.equal(result.status, 401);
    });

    await t.test("Parámetro desconocido: HTTP 400", async () => {
      const result = await request(`${prefix}?empresa_id=2`);
      assert.equal(result.status, 400);
    });

    await t.test("Fecha calendario inválida: HTTP 400", async () => {
      const result = await request(
        `${prefix}?fecha_desde=2026-02-30`
      );
      assert.equal(result.status, 400);
    });

    await t.test("Fechas invertidas: HTTP 400", async () => {
      const result = await request(
        `${prefix}?fecha_desde=2026-10-03&fecha_hasta=2026-09-25`
      );
      assert.equal(result.status, 400);
    });

    await t.test("Más de 31 días: HTTP 400", async () => {
      const result = await request(
        `${prefix}?fecha_desde=2026-09-01&fecha_hasta=2026-10-03`
      );
      assert.equal(result.status, 400);
    });

    await t.test("Sucursal inválida: HTTP 400", async () => {
      const result = await request(`${prefix}?sucursal_id=0`);
      assert.equal(result.status, 400);
    });

    await t.test("Sucursal inexistente: HTTP 404", async () => {
      const result = await request(
        `${prefix}?sucursal_id=9223372036854775807`
      );
      assert.equal(result.status, 404);
    });

    await t.test("Empresa manipulada: HTTP 401", async () => {
      const invalidToken = await tokenService.createAccessToken({
        userId: admin.id,
        empresaId: 0n
      });

      const result = await request(prefix, invalidToken);
      assert.equal(result.status, 401);
    });

    await t.test("ADMIN: Dashboard predeterminado HTTP 200", async () => {
      const result = await request(prefix);

      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.ok, true);

      const data = result.body.data;

      assert.equal(data.periodo.moneda, admin.empresa.moneda);
      assert.equal(
        data.periodo.zona_horaria,
        admin.empresa.zona_horaria
      );

      assert.ok(data.indicadores.ventas);
      assert.ok(data.indicadores.caja);
      assert.ok(data.indicadores.inventario);

      // El permiso ECOMMERCE_SYNC.VER no tiene roles
      // asignados en la inspección inicial.
      assert.equal(
        Object.hasOwn(data.indicadores, "ecommerce"),
        false
      );
    });

    const from = "2026-09-25";
    const to = "2026-10-03";

    const historicalPath =
      `${prefix}?fecha_desde=${from}` +
      `&fecha_hasta=${to}` +
      `&sucursal_id=${branch.id}`;

    await t.test(
      "Ventas y devoluciones contra Prisma real",
      async () => {
        const result = await request(historicalPath);

        assert.equal(
          result.status,
          200,
          JSON.stringify(result.body)
        );

        const dashboard = result.body.data;

        assert.equal(dashboard.periodo.fecha_desde, from);
        assert.equal(dashboard.periodo.fecha_hasta, to);
        assert.equal(
          dashboard.sucursal_id,
          branch.id.toString()
        );

        const bounds = await prisma.$queryRaw`
          SELECT
            (
              ${from}::date::timestamp
              AT TIME ZONE ${admin.empresa.zona_horaria}
            ) AS inicio,
            (
              (${to}::date + INTERVAL '1 day')
              AT TIME ZONE ${admin.empresa.zona_horaria}
            ) AS fin
        `;

        const { inicio, fin } = bounds[0];

        const sales = await prisma.venta.aggregate({
          where: {
            empresa_id: admin.empresa_id,
            sucursal_id: branch.id,
            estado: "COMPLETADA",
            fecha: { gte: inicio, lt: fin }
          },
          _count: { _all: true },
          _sum: { total: true }
        });

        const refunds = await prisma.devolucion_venta.aggregate({
          where: {
            fecha: { gte: inicio, lt: fin },
            venta: {
              empresa_id: admin.empresa_id,
              sucursal_id: branch.id,
              estado: "COMPLETADA"
            }
          },
          _count: { _all: true },
          _sum: { total: true }
        });

        const zero = new Prisma.Decimal(0);
        const gross = sales._sum.total ?? zero;
        const refunded = refunds._sum.total ?? zero;
        const indicators = dashboard.indicadores.ventas;

        assert.equal(indicators.operaciones, sales._count._all);
        assert.equal(
          indicators.devoluciones_registradas,
          refunds._count._all
        );

        assert.equal(
          indicators.ventas_brutas,
          gross.toFixed(2)
        );

        assert.equal(
          indicators.monto_devuelto,
          refunded.toFixed(2)
        );

        assert.equal(
          indicators.ventas_netas,
          gross.minus(refunded).toFixed(2)
        );

        assert.equal(
          indicators.ticket_promedio,
          sales._count._all
            ? gross.div(sales._count._all).toFixed(2)
            : "0.00"
        );

        const trend = indicators.tendencia_diaria;

        assert.equal(trend.length, 9);
        assert.equal(trend[0].fecha, from);
        assert.equal(trend.at(-1).fecha, to);

        const trendGross = trend.reduce(
          (sum, row) =>
            sum.plus(row.ventas_brutas),
          new Prisma.Decimal(0)
        );

        const trendRefunds = trend.reduce(
          (sum, row) =>
            sum.plus(row.devoluciones),
          new Prisma.Decimal(0)
        );

        assert.equal(trendGross.toFixed(2), gross.toFixed(2));
        assert.equal(
          trendRefunds.toFixed(2),
          refunded.toFixed(2)
        );

        console.log({
          operaciones: indicators.operaciones,
          ventas_brutas: indicators.ventas_brutas,
          devoluciones: indicators.monto_devuelto,
          ventas_netas: indicators.ventas_netas,
          dias: trend.length,
          resultado: "PASS"
        });
      }
    );

    await t.test("Caja y existencias contra Prisma", async () => {
      const result = await request(historicalPath);

      assert.equal(
        result.status,
        200,
        JSON.stringify(result.body)
      );

      const cash = result.body.data.indicadores.caja;
      const inventory = result.body.data.indicadores.inventario;

      const registers = await prisma.caja.count({
        where: {
          sucursal_id: branch.id,
          activo: true,
          sucursal: {
            empresa_id: admin.empresa_id,
            activo: true
          }
        }
      });

      const openSessions = await prisma.sesion_caja.count({
        where: {
          estado: "ABIERTA",
          caja: {
            sucursal_id: branch.id,
            activo: true,
            sucursal: {
              empresa_id: admin.empresa_id,
              activo: true
            }
          }
        }
      });

      assert.equal(cash.cajas_activas, registers);
      assert.equal(cash.sesiones_abiertas, openSessions);

      const rows = await prisma.existencia.findMany({
        where: {
          almacen: {
            sucursal_id: branch.id,
            activo: true,
            sucursal: {
              empresa_id: admin.empresa_id,
              activo: true
            }
          },
          producto: {
            empresa_id: admin.empresa_id,
            activo: true,
            controla_inventario: true
          }
        },
        select: {
          disponible: true,
          producto: {
            select: { stock_minimo: true }
          }
        }
      });

      assert.equal(
        inventory.existencias_registradas,
        rows.length
      );

      assert.equal(
        inventory.bajo_minimo,
        rows.filter(row =>
          row.disponible !== null &&
          row.disponible.lt(row.producto.stock_minimo)
        ).length
      );

      assert.equal(
        inventory.agotadas,
        rows.filter(row =>
          row.disponible !== null &&
          row.disponible.lte(0)
        ).length
      );
    });

    const unauthorized = await prisma.usuario.findFirst({
      where: {
        activo: true,
        bloqueado: false,
        empresa_id: admin.empresa_id,
        usuario_rol: {
          none: {
            rol: {
              activo: true,
              rol_permiso: {
                some: {
                  permiso: { codigo: "DASHBOARD.VER" }
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

    await t.test(
      "Usuario sin DASHBOARD.VER: HTTP 403",
      async st => {
        if (!unauthorized) {
          st.skip("No existe usuario activo sin ese permiso.");
          return;
        }

        const otherToken = await tokenService.createAccessToken({
          userId: unauthorized.id,
          empresaId: unauthorized.empresa_id
        });

        const result = await request(prefix, otherToken);

        assert.equal(result.status, 403);
      }
    );

    await t.test("Las consultas no modifican datos", async () => {
      assert.deepEqual({
        auditorias: await prisma.auditoria.count(),
        ventas: await prisma.venta.count(),
        devoluciones: await prisma.devolucion_venta.count()
      }, initialCounts);
    });

    console.log("\nM16: PRUEBAS HTTP FINALIZADAS.");

  } finally {
    if (server) {
      server.closeAllConnections();

      await new Promise(resolve => {
        server.close(resolve);
      });
    }

    await prisma.$disconnect();
  }
});
