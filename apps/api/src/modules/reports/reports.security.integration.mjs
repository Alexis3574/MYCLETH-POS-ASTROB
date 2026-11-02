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
  throw new Error("Base de datos no autorizada.");
}

const definitions = [
  ["ventas", "VENTAS.VER"],
  ["devoluciones", "VENTAS.VER"],
  ["compras", "COMPRAS.VER"],
  ["inventario", "INVENTARIO.VER"],
  ["existencias", "INVENTARIO.VER"],
  ["caja", "CAJAS.VER"],
];

test("M17: CSV neutraliza formulas y caracteres invisibles", async () => {
  const { csvCell } = await import("./reports.csv.ts");

  const attacks = [
    "=1+1",
    "+SUM(A1:A2)",
    "-cmd",
    "@SUM(A1)",
    "\t=1+1",
    "\r\n=1+1",
    "\uFEFF=1+1",
    "\u200B=1+1",
    "\u200E@SUM(A1)",
    "\u2060+1",
    " \t=HYPERLINK(A1)",
    "\u001F-IMPORT",
  ];

  for (const attack of attacks) {
    const result = csvCell(attack);

    assert.ok(
      result.startsWith("\"'"),
      `Formula no neutralizada: ${JSON.stringify(attack)}`
    );
  }

  assert.equal(csvCell("-10.00"), '"-10.00"');
  assert.equal(csvCell("-0.125"), '"-0.125"');
  assert.equal(csvCell("100.50"), '"100.50"');
  assert.equal(csvCell("Texto normal"), '"Texto normal"');
});

test("M17: autorizacion real en JSON y CSV", async t => {
  const { app } = await import("../../app.ts");
  const { prisma } = await import("../../lib/prisma.ts");
  const { tokenService } = await import(
    "../auth/token.service.ts"
  );
  const { loadBranchAccess } = await import(
    "../inventory/authorization/branch-access.ts"
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
        empresa_id: true
      }
    });

    assert.ok(admin, "ADMIN autorizado no encontrado.");

    const users = await prisma.usuario.findMany({
      where: {
        empresa_id: admin.empresa_id,
        activo: true,
        bloqueado: false
      },
      take: 30,
      orderBy: { id: "asc" },
      select: {
        id: true,
        empresa_id: true,
        usuario_rol: {
          select: {
            rol: {
              select: {
                codigo: true,
                activo: true,
                rol_permiso: {
                  select: {
                    permiso: {
                      select: { codigo: true }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    assert.ok(
      users.some(user => user.id === admin.id),
      "ADMIN no incluido en la matriz."
    );

    function permissions(user) {
      return new Set(
        user.usuario_rol
          .filter(link => link.rol.activo)
          .flatMap(link =>
            link.rol.rol_permiso.map(item =>
              item.permiso.codigo
            )
          )
      );
    }

    const before = {
      auditorias: await prisma.auditoria.count(),
      ventas: await prisma.venta.count(),
      devoluciones: await prisma.devolucion_venta.count(),
      compras: await prisma.compra.count(),
      movimientos_inventario:
        await prisma.movimiento_inventario.count(),
      movimientos_caja:
        await prisma.movimiento_caja.count()
    };

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const base = `http://127.0.0.1:${address.port}`;
    const prefix = "/api/v1/reports";

    async function request(path, token = null) {
      const response = await fetch(base + path, {
        headers: token
          ? { Authorization: `Bearer ${token}` }
          : {},
        signal: AbortSignal.timeout(15000)
      });

      const contentType =
        response.headers.get("content-type") ?? "";

      // Se consumen los bytes también para CSV.
      const body = Buffer.from(
        await response.arrayBuffer()
      );

      return {
        status: response.status,
        contentType,
        cacheControl:
          response.headers.get("cache-control"),
        body
      };
    }

    await t.test(
      "Sin autenticacion: las 12 rutas denegadas",
      async () => {
        for (const [kind] of definitions) {
          for (const suffix of ["", "/export.csv"]) {
            const result = await request(
              `${prefix}/${kind}${suffix}`
            );

            assert.equal(
              result.status,
              401,
              `${kind}${suffix}`
            );
          }
        }
      }
    );

    await t.test(
      "Matriz de roles y sucursales reales",
      async st => {
        const sampledUsers = users.slice(0, 15);

        for (const user of sampledUsers) {
          await st.test(
            `Usuario ${user.id.toString()}`,
            async () => {
              const granted = permissions(user);

              const access = await loadBranchAccess(
                prisma,
                {
                  userId: user.id,
                  empresaId: user.empresa_id
                }
              );

              const hasBranch =
                access.global ||
                access.sucursalIds.length > 0;

              const token =
                await tokenService.createAccessToken({
                  userId: user.id,
                  empresaId: user.empresa_id
                });

              let visible = 0;
              let denied = 0;

              for (const [kind, permission] of definitions) {
                const authorized =
                  granted.has("REPORTES.VER") &&
                  granted.has(permission) &&
                  hasBranch;

                const expected = authorized ? 200 : 403;

                for (const suffix of ["", "/export.csv"]) {
                  const result = await request(
                    `${prefix}/${kind}${suffix}`,
                    token
                  );

                  assert.equal(
                    result.status,
                    expected,
                    [
                      `usuario=${user.id}`,
                      `reporte=${kind}${suffix}`,
                      `esperado=${expected}`,
                      `real=${result.status}`
                    ].join(" ")
                  );

                  if (authorized) {
                    assert.match(
                      result.cacheControl ?? "",
                      /no-store/i
                    );

                    if (suffix === "/export.csv") {
                      assert.match(
                        result.contentType,
                        /text\/csv/i
                      );

                      assert.deepEqual(
                        [...result.body.subarray(0, 3)],
                        [239, 187, 191],
                        "CSV sin BOM UTF-8"
                      );
                    }

                    visible++;
                  } else {
                    denied++;
                  }
                }
              }

              console.log({
                usuario: user.id.toString(),
                global: access.global,
                sucursales: access.sucursalIds.length,
                endpoints_permitidos: visible,
                endpoints_denegados: denied,
                resultado: "PASS"
              });
            }
          );
        }
      }
    );

    await t.test(
      "Sucursal ajena o inexistente: JSON y CSV HTTP 404",
      async () => {
        const token =
          await tokenService.createAccessToken({
            userId: admin.id,
            empresaId: admin.empresa_id
          });

        const otherId = "9223372036854775807";

        for (const [kind] of definitions) {
          for (const suffix of ["", "/export.csv"]) {
            const result = await request(
              `${prefix}/${kind}${suffix}` +
              `?sucursal_id=${otherId}`,
              token
            );

            assert.equal(
              result.status,
              404,
              `${kind}${suffix}`
            );
          }
        }
      }
    );

    await t.test(
      "Sucursal real sin autorizacion: HTTP 404",
      async st => {
        const branches = await prisma.sucursal.findMany({
          where: {
            empresa_id: admin.empresa_id,
            activo: true
          },
          select: { id: true }
        });

        let scenario = null;

        for (const user of users) {
          const granted = permissions(user);

          if (
            !granted.has("REPORTES.VER") ||
            !granted.has("VENTAS.VER")
          ) continue;

          const access = await loadBranchAccess(
            prisma,
            {
              userId: user.id,
              empresaId: user.empresa_id
            }
          );

          if (access.global) continue;

          const deniedBranch = branches.find(branch =>
            !access.sucursalIds.includes(branch.id)
          );

          if (deniedBranch) {
            scenario = {
              user,
              deniedBranch
            };
            break;
          }
        }

        if (!scenario) {
          st.skip(
            "Sin usuario y sucursal reales para comprobar " +
            "esta combinacion de permisos."
          );
          return;
        }

        const token =
          await tokenService.createAccessToken({
            userId: scenario.user.id,
            empresaId: scenario.user.empresa_id
          });

        for (const suffix of ["", "/export.csv"]) {
          const result = await request(
            `${prefix}/ventas${suffix}` +
            `?sucursal_id=${scenario.deniedBranch.id}`,
            token
          );

          assert.equal(result.status, 404);
        }
      }
    );

    await t.test(
      "JSON y CSV rechazan filtros desconocidos",
      async () => {
        const token =
          await tokenService.createAccessToken({
            userId: admin.id,
            empresaId: admin.empresa_id
          });

        for (const suffix of ["", "/export.csv"]) {
          const result = await request(
            `${prefix}/ventas${suffix}?empresa_id=2`,
            token
          );

          assert.equal(result.status, 400);
        }
      }
    );

    await t.test(
      "Sin modificaciones en PostgreSQL",
      async () => {
        const after = {
          auditorias: await prisma.auditoria.count(),
          ventas: await prisma.venta.count(),
          devoluciones: await prisma.devolucion_venta.count(),
          compras: await prisma.compra.count(),
          movimientos_inventario:
            await prisma.movimiento_inventario.count(),
          movimientos_caja:
            await prisma.movimiento_caja.count()
        };

        assert.deepEqual(after, before);
      }
    );

    console.log({
      usuarios_encontrados: users.length,
      usuarios_evaluados: Math.min(users.length, 15),
      rutas: definitions.length * 2,
      base_datos: "pos_novnix",
      resultado: "M17 SEGURIDAD REVISADA"
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
