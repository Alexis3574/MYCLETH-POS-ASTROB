import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

const url = process.env.DATABASE_URL;

if (
  !url ||
  decodeURIComponent(
    new URL(url).pathname.replace(/^\/+/, "")
  ) !== "pos_novnix"
) {
  throw new Error("Solo se permite la base pos_novnix.");
}

function parseCsv(content) {
  const text = content.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" || char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";

      if (char === "\r" && text[i + 1] === "\n") {
        i++;
      }
    } else {
      cell += char;
    }
  }

  assert.equal(quoted, false, "CSV con comillas sin cerrar");

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

test("M17: integracion HTTP real y exportaciones", async t => {
  const { app } = await import("../../app.ts");
  const { prisma } = await import("../../lib/prisma.ts");
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
                  permiso: { codigo: "REPORTES.VER" }
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

    assert.ok(admin, "No existe ADMIN con REPORTES.VER.");

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

    const before = {
      auditorias: await prisma.auditoria.count(),
      ventas: await prisma.venta.count(),
      devoluciones: await prisma.devolucion_venta.count(),
      compras: await prisma.compra.count(),
      inventario: await prisma.movimiento_inventario.count(),
      caja: await prisma.movimiento_caja.count()
    };

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const base = `http://127.0.0.1:${address.port}`;
    const prefix = "/api/v1/reports";

    async function request(
      path,
      authorization = token
    ) {
      const response = await fetch(base + path, {
        headers: authorization
          ? { Authorization: `Bearer ${authorization}` }
          : {},
        signal: AbortSignal.timeout(15000)
      });

      const contentType =
        response.headers.get("content-type") ?? "";

      const content = contentType.includes("application/json")
        ? await response.json()
        : Buffer.from(await response.arrayBuffer()).toString("utf8");

      return {
        status: response.status,
        contentType,
        disposition: response.headers.get(
          "content-disposition"
        ),
        cacheControl: response.headers.get(
          "cache-control"
        ),
        body: content
      };
    }

    const from = "2026-09-25";
    const to = "2026-10-03";

    const baseQuery =
      `fecha_desde=${from}&fecha_hasta=${to}` +
      `&sucursal_id=${branch.id}`;

    const stockQuery = `sucursal_id=${branch.id}`;

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

    assert.ok(bounds[0]);

    const dates = {
      gte: bounds[0].inicio,
      lt: bounds[0].fin
    };

    const branchWhere = {
      id: branch.id,
      empresa_id: admin.empresa_id,
      activo: true
    };

    const expected = {
      ventas: await prisma.venta.count({
        where: {
          empresa_id: admin.empresa_id,
          sucursal: branchWhere,
          fecha: dates
        }
      }),

      devoluciones: await prisma.devolucion_venta.count({
        where: {
          venta: {
            empresa_id: admin.empresa_id,
            sucursal: branchWhere
          },
          fecha: dates
        }
      }),

      compras: await prisma.compra.count({
        where: {
          empresa_id: admin.empresa_id,
          sucursal: branchWhere,
          fecha: dates
        }
      }),

      inventario: await prisma.movimiento_inventario.count({
        where: {
          producto: {
            empresa_id: admin.empresa_id
          },
          almacen: {
            sucursal: branchWhere
          },
          fecha: dates
        }
      }),

      existencias: await prisma.existencia.count({
        where: {
          producto: {
            empresa_id: admin.empresa_id,
            activo: true,
            controla_inventario: true
          },
          almacen: {
            activo: true,
            sucursal: branchWhere
          }
        }
      }),

      caja: await prisma.movimiento_caja.count({
        where: {
          sesion_caja: {
            caja: {
              sucursal: branchWhere
            }
          },
          fecha: dates
        }
      })
    };

    await t.test("Sin JWT: HTTP 401", async () => {
      const result = await request(
        `${prefix}/ventas`,
        null
      );

      assert.equal(result.status, 401);
    });

    await t.test("JWT invalido: HTTP 401", async () => {
      const result = await request(
        `${prefix}/ventas`,
        "token.invalido"
      );

      assert.equal(result.status, 401);
    });

    await t.test(
      "Empresa manipulada: HTTP 401",
      async () => {
        const forged = await tokenService.createAccessToken({
          userId: admin.id,
          empresaId: 0n
        });

        const result = await request(
          `${prefix}/ventas`,
          forged
        );

        assert.equal(result.status, 401);
      }
    );

    await t.test(
      "Parametro empresa_id prohibido: HTTP 400",
      async () => {
        const result = await request(
          `${prefix}/ventas?empresa_id=2`
        );

        assert.equal(result.status, 400);
      }
    );

    await t.test("Fecha invalida: HTTP 400", async () => {
      const result = await request(
        `${prefix}/ventas?fecha_desde=2026-02-30`
      );

      assert.equal(result.status, 400);
    });

    await t.test(
      "Periodo invertido: HTTP 400",
      async () => {
        const result = await request(
          `${prefix}/ventas?fecha_desde=2026-10-03` +
          `&fecha_hasta=2026-09-25`
        );

        assert.equal(result.status, 400);
      }
    );

    await t.test(
      "Periodo excesivo: HTTP 400",
      async () => {
        const result = await request(
          `${prefix}/ventas?fecha_desde=2024-01-01` +
          `&fecha_hasta=2026-10-03`
        );

        assert.equal(result.status, 400);
      }
    );

    await t.test(
      "Paginacion invalida: HTTP 400",
      async () => {
        const result = await request(
          `${prefix}/ventas?page=0&limit=101`
        );

        assert.equal(result.status, 400);
      }
    );

    await t.test(
      "Sucursal inexistente: HTTP 404",
      async () => {
        const result = await request(
          `${prefix}/ventas?` +
          `sucursal_id=9223372036854775807`
        );

        assert.equal(result.status, 404);
      }
    );

    const kinds = [
      "ventas",
      "devoluciones",
      "compras",
      "inventario",
      "existencias",
      "caja"
    ];

    for (const kind of kinds) {
      const query = kind === "existencias"
        ? stockQuery
        : baseQuery;

      await t.test(
        `${kind}: JSON, CSV y conteo real`,
        async () => {
          const json = await request(
            `${prefix}/${kind}?${query}&limit=100`
          );

          assert.equal(
            json.status,
            200,
            JSON.stringify(json.body)
          );

          assert.equal(json.body.ok, true);

          const report = json.body.data;

          assert.equal(report.tipo, kind);
          assert.equal(report.moneda, admin.empresa.moneda);

          assert.equal(
            report.sucursal_id,
            branch.id.toString()
          );

          assert.equal(
            report.pagination.total,
            expected[kind]
          );

          assert.equal(
            report.pagination.page,
            1
          );

          assert.equal(
            report.data.length,
            Math.min(expected[kind], 100)
          );

          assert.ok(
            report.data.every(item =>
              typeof item === "object" &&
              item !== null
            )
          );

          if (kind === "existencias") {
            assert.equal(report.periodo, null);
          } else {
            assert.equal(
              report.periodo.fecha_desde,
              from
            );

            assert.equal(
              report.periodo.fecha_hasta,
              to
            );
          }

          const csv = await request(
            `${prefix}/${kind}/export.csv?${query}`
          );

          assert.equal(
            csv.status,
            200,
            typeof csv.body === "string"
              ? csv.body.slice(0, 300)
              : JSON.stringify(csv.body)
          );

          assert.match(
            csv.contentType,
            /text\/csv/i
          );

          assert.match(
            csv.disposition ?? "",
            /attachment/i
          );

          assert.match(
            csv.cacheControl ?? "",
            /no-store/i
          );

          assert.equal(
            typeof csv.body,
            "string"
          );

          assert.ok(
            csv.body.startsWith("\uFEFF")
          );

          const parsed = parseCsv(csv.body);

          assert.ok(
            parsed.length >= 1,
            "El CSV debe tener encabezado."
          );

          assert.ok(
            parsed[0].length >= 5
          );

          assert.equal(
            parsed.length - 1,
            expected[kind],
            `Conteo CSV incorrecto: ${kind}`
          );

          for (const row of parsed.slice(1)) {
            assert.equal(
              row.length,
              parsed[0].length,
              `Columnas CSV inconsistentes: ${kind}`
            );
          }

          console.log({
            reporte: kind,
            registros: expected[kind],
            json: "PASS",
            csv: "PASS"
          });
        }
      );
    }

    await t.test(
      "Ventas: filtro de estado correcto",
      async () => {
        const result = await request(
          `${prefix}/ventas?${baseQuery}` +
          `&estado=COMPLETADA&limit=100`
        );

        assert.equal(
          result.status,
          200,
          JSON.stringify(result.body)
        );

        const independent = await prisma.venta.count({
          where: {
            empresa_id: admin.empresa_id,
            sucursal: branchWhere,
            fecha: dates,
            estado: "COMPLETADA"
          }
        });

        assert.equal(
          result.body.data.pagination.total,
          independent
        );

        assert.ok(
          result.body.data.data.every(row =>
            row.estado === "COMPLETADA"
          )
        );
      }
    );

    await t.test(
      "Inventario: filtro de tipo correcto",
      async () => {
        const result = await request(
          `${prefix}/inventario?${baseQuery}` +
          `&tipo=ENTRADA&limit=100`
        );

        assert.equal(
          result.status,
          200,
          JSON.stringify(result.body)
        );

        const independent =
          await prisma.movimiento_inventario.count({
            where: {
              producto: {
                empresa_id: admin.empresa_id
              },
              almacen: {
                sucursal: branchWhere
              },
              fecha: dates,
              tipo: "ENTRADA"
            }
          });

        assert.equal(
          result.body.data.pagination.total,
          independent
        );

        assert.ok(
          result.body.data.data.every(row =>
            row.tipo === "ENTRADA"
          )
        );
      }
    );

    await t.test(
      "Caja: filtro de tipo correcto",
      async () => {
        const result = await request(
          `${prefix}/caja?${baseQuery}` +
          `&tipo=SALIDA&limit=100`
        );

        assert.equal(
          result.status,
          200,
          JSON.stringify(result.body)
        );

        assert.ok(
          result.body.data.data.every(row =>
            row.tipo === "SALIDA"
          )
        );
      }
    );

    await t.test(
      "Ventas: paginacion consistente",
      async () => {
        const first = await request(
          `${prefix}/ventas?${baseQuery}&limit=2&page=1`
        );

        const second = await request(
          `${prefix}/ventas?${baseQuery}&limit=2&page=2`
        );

        assert.equal(first.status, 200);
        assert.equal(second.status, 200);

        assert.equal(
          first.body.data.pagination.total,
          second.body.data.pagination.total
        );

        const firstIds = first.body.data.data
          .map(row => row.id);

        const secondIds = second.body.data.data
          .map(row => row.id);

        for (const id of firstIds) {
          assert.equal(secondIds.includes(id), false);
        }
      }
    );

    await t.test(
      "Usuario sin REPORTES.VER: HTTP 403",
      async st => {
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
                        codigo: "REPORTES.VER"
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

        if (!unauthorized) {
          st.skip(
            "No hay usuario real sin REPORTES.VER."
          );
          return;
        }

        const deniedToken =
          await tokenService.createAccessToken({
            userId: unauthorized.id,
            empresaId: unauthorized.empresa_id
          });

        const json = await request(
          `${prefix}/ventas`,
          deniedToken
        );

        const csv = await request(
          `${prefix}/ventas/export.csv`,
          deniedToken
        );

        assert.equal(json.status, 403);
        assert.equal(csv.status, 403);
      }
    );

    await t.test(
      "Sin modificaciones en datos ni auditoria",
      async () => {
        const after = {
          auditorias: await prisma.auditoria.count(),
          ventas: await prisma.venta.count(),
          devoluciones: await prisma.devolucion_venta.count(),
          compras: await prisma.compra.count(),
          inventario: await prisma.movimiento_inventario.count(),
          caja: await prisma.movimiento_caja.count()
        };

        assert.deepEqual(after, before);
      }
    );

    console.log("\n=== RESULTADO M17 ===");
    console.table(
      kinds.map(kind => ({
        reporte: kind,
        registros: expected[kind]
      }))
    );

    console.log(
      "M17: INTEGRACION HTTP Y CSV FINALIZADA."
    );

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
