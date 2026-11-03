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
  throw new Error("Solo se permite pos_novnix.");
}

test("M16: permisos por indicador y alcance real", async t => {
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

    assert.ok(admin, "ADMIN autorizado no encontrado.");

    const users = await prisma.usuario.findMany({
      where: {
        empresa_id: admin.empresa_id,
        activo: true,
        bloqueado: false
      },
      take: 50,
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

    const snapshot = {
      auditorias: await prisma.auditoria.count(),
      ventas: await prisma.venta.count(),
      devoluciones: await prisma.devolucion_venta.count()
    };

    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");

    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const base = `http://127.0.0.1:${address.port}`;

    async function request(userId, empresaId, suffix = "") {
      const token = await tokenService.createAccessToken({
        userId,
        empresaId
      });

      const response = await fetch(
        `${base}/api/v1/dashboard/summary${suffix}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          signal: AbortSignal.timeout(15000)
        }
      );

      return {
        status: response.status,
        body: await response.json()
      };
    }

    function permissions(user) {
      return new Set(
        user.usuario_rol
          .filter(item => item.rol.activo)
          .flatMap(item =>
            item.rol.rol_permiso.map(link =>
              link.permiso.codigo
            )
          )
      );
    }

    const indicatorPermissions = {
      ventas: "VENTAS.VER",
      caja: "CAJAS.VER",
      inventario: "INVENTARIO.VER",
      ecommerce: "ECOMMERCE_SYNC.VER"
    };

    const eligible = users.filter(user =>
      permissions(user).has("DASHBOARD.VER")
    );

    assert.ok(
      eligible.some(user => user.id === admin.id),
      "ADMIN no figura entre los usuarios autorizados."
    );

    await t.test(
      "Las secciones coinciden con los permisos efectivos",
      async st => {
        for (const user of eligible.slice(0, 15)) {
          await st.test(
            `Usuario ${user.id.toString()}`,
            async () => {
              const actor = {
                userId: user.id,
                empresaId: user.empresa_id
              };

              const access = await loadBranchAccess(
                prisma,
                actor
              );

              const result = await request(
                user.id,
                user.empresa_id
              );

              if (
                !access.global &&
                access.sucursalIds.length === 0
              ) {
                assert.equal(result.status, 403);
                return;
              }

              assert.equal(
                result.status,
                200,
                JSON.stringify(result.body)
              );

              assert.equal(result.body.ok, true);

              const visible =
                Object.keys(result.body.data.indicadores)
                  .sort();

              const granted = permissions(user);

              const expected =
                Object.entries(indicatorPermissions)
                  .filter(([, permission]) =>
                    granted.has(permission)
                  )
                  .map(([indicator]) => indicator)
                  .sort();

              assert.deepEqual(visible, expected);

              console.log({
                usuario_id: user.id.toString(),
                indicadores: visible,
                alcance_global: access.global,
                sucursales: access.sucursalIds.length,
                resultado: "PASS"
              });
            }
          );
        }
      }
    );

    await t.test(
      "Usuarios sin DASHBOARD.VER no acceden",
      async st => {
        const user = users.find(candidate =>
          !permissions(candidate).has("DASHBOARD.VER")
        );

        if (!user) {
          st.skip("No existe usuario activo sin DASHBOARD.VER.");
          return;
        }

        const result = await request(
          user.id,
          user.empresa_id
        );

        assert.equal(result.status, 403);
      }
    );

    await t.test(
      "Sucursal no autorizada no es visible",
      async st => {
        const branches = await prisma.sucursal.findMany({
          where: {
            empresa_id: admin.empresa_id,
            activo: true
          },
          select: { id: true }
        });

        let scenario = null;

        for (const user of eligible) {
          const access = await loadBranchAccess(prisma, {
            userId: user.id,
            empresaId: user.empresa_id
          });

          if (access.global) continue;

          const denied = branches.find(branch =>
            !access.sucursalIds.includes(branch.id)
          );

          if (denied) {
            scenario = { user, denied };
            break;
          }
        }

        if (!scenario) {
          st.skip(
            "Sin usuario y sucursal distintos para probar aislamiento real."
          );
          return;
        }

        const result = await request(
          scenario.user.id,
          scenario.user.empresa_id,
          `?sucursal_id=${scenario.denied.id}`
        );

        assert.equal(result.status, 404);
      }
    );

    await t.test(
      "Sin modificaciones en datos ni auditoría",
      async () => {
        assert.deepEqual({
          auditorias: await prisma.auditoria.count(),
          ventas: await prisma.venta.count(),
          devoluciones: await prisma.devolucion_venta.count()
        }, snapshot);
      }
    );

    console.log({
      usuarios_revisados: eligible.length,
      empresa: admin.empresa_id.toString(),
      resultado: "SEGURIDAD M16 VERIFICADA"
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
