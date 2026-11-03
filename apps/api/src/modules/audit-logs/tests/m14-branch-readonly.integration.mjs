import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";

const connection = process.env.DATABASE_URL;

if (!connection) {
  throw new Error("DATABASE_URL no definida.");
}

const url = new URL(connection);

const dbName = decodeURIComponent(
  url.pathname.replace(/^\/+/, "")
);

if (dbName !== "pos_novnix") {
  throw new Error("Base de datos no autorizada.");
}

url.searchParams.set(
  "options",
  [
    url.searchParams.get("options"),
    "-c default_transaction_read_only=on"
  ].filter(Boolean).join(" ")
);

process.env.DATABASE_URL = url.toString();

test("M14: aislamiento por sucursal", async t => {
  const { prisma } =
    await import("../../../lib/prisma.ts");

  const { loadBranchAccess } =
    await import(
      "../../inventory/authorization/branch-access.ts"
    );

  const { auditRepository } =
    await import(
      "../repositories/audit.repository.ts"
    );

  const { auditListSchema } =
    await import("../validators/audit.schema.ts");

  try {
    const before = await prisma.auditoria.count();

    const event = await prisma.auditoria.findFirst({
      where: {
        tabla: "venta",
        registro_id: { not: null }
      },
      select: {
        id: true,
        registro_id: true
      },
      orderBy: [
        { creado_en: "desc" },
        { id: "desc" }
      ]
    });

    assert.ok(event?.registro_id);

    const sale = await prisma.venta.findUnique({
      where: { id: event.registro_id },
      select: {
        id: true,
        empresa_id: true,
        sucursal_id: true
      }
    });

    assert.ok(sale);

    const admin = await prisma.usuario.findFirst({
      where: {
        empresa_id: sale.empresa_id,
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

    assert.ok(admin);

    const actor = {
      userId: admin.id,
      empresaId: admin.empresa_id
    };

    const query = auditListSchema.parse({
      page: "1",
      limit: "100"
    });

    await prisma.$transaction(async tx => {
      const check = await tx.$queryRaw`
        SELECT
          current_database() AS database,
          current_setting(
            'transaction_read_only'
          ) AS readonly
      `;

      assert.equal(
        check[0]?.database,
        "pos_novnix"
      );

      assert.equal(
        check[0]?.readonly,
        "on"
      );

      await t.test(
        "ADMIN conserva acceso global de su empresa",
        async () => {
          const access = await loadBranchAccess(
            tx,
            actor
          );

          assert.equal(access.global, true);

          const result = await auditRepository.list(
            tx, actor, access, query
          );

          assert.ok(
            result.rows.some(
              row => row.id === event.id
            )
          );
        }
      );

      await t.test(
        "Sucursales vacias deniegan listado y detalle",
        async () => {
          const access = {
            empresaId: actor.empresaId,
            global: false,
            sucursalIds: []
          };

          const result = await auditRepository.list(
            tx, actor, access, query
          );

          assert.equal(result.rows.length, 0);
          assert.equal(result.total, 0n);

          const detail =
            await auditRepository.getById(
              tx, actor, access, event.id
            );

          assert.equal(detail, null);
        }
      );

      await t.test(
        "Sucursal autorizada permite su propio evento",
        async () => {
          const access = {
            empresaId: actor.empresaId,
            global: false,
            sucursalIds: [sale.sucursal_id]
          };

          const detail =
            await auditRepository.getById(
              tx, actor, access, event.id
            );

          assert.ok(detail);
          assert.equal(detail.id, event.id);
          assert.equal(
            detail.sucursal_id,
            sale.sucursal_id
          );
        }
      );

      await t.test(
        "Sucursal diferente deniega el evento",
        async () => {
          const access = {
            empresaId: actor.empresaId,
            global: false,
            sucursalIds: [0n]
          };

          const detail =
            await auditRepository.getById(
              tx, actor, access, event.id
            );

          assert.equal(detail, null);

          const result = await auditRepository.list(
            tx, actor, access, query
          );

          assert.equal(result.total, 0n);
        }
      );

      const nonAdmin = await tx.usuario.findFirst({
        where: {
          empresa_id: sale.empresa_id,
          activo: true,
          bloqueado: false,
          empresa: { activo: true },
          usuario_rol: {
            none: {
              rol: {
                codigo: "ADMIN",
                activo: true
              }
            }
          },
          usuario_sucursal: {
            some: {
              sucursal: {
                id: sale.sucursal_id,
                empresa_id: sale.empresa_id,
                activo: true
              }
            }
          }
        },
        select: {
          id: true,
          empresa_id: true
        }
      });

      if (nonAdmin) {
        await t.test(
          "Usuario no ADMIN: asignaciones actuales",
          async () => {
            const branchActor = {
              userId: nonAdmin.id,
              empresaId: nonAdmin.empresa_id
            };

            const access = await loadBranchAccess(
              tx,
              branchActor
            );

            assert.equal(access.global, false);

            assert.ok(
              access.sucursalIds.includes(
                sale.sucursal_id
              )
            );

            const detail =
              await auditRepository.getById(
                tx,
                branchActor,
                access,
                event.id
              );

            assert.ok(detail);

            console.log(
              "Asignacion real de sucursal: VALIDADA."
            );
          }
        );
      } else {
        console.log(
          "PENDIENTE: no existe usuario no ADMIN " +
          "activo asignado a la sucursal del evento."
        );
      }
    }, {
      isolationLevel: "RepeatableRead"
    });

    const after = await prisma.auditoria.count();

    assert.equal(after, before);

    console.log({
      eventos_antes: before,
      eventos_despues: after,
      historial_conservado: true
    });

    console.log(
      "NOTA: la revocacion se simulo mediante " +
      "un alcance vacio. No se modificaron " +
      "asignaciones reales."
    );

  } finally {
    await prisma.$disconnect();
  }
});
