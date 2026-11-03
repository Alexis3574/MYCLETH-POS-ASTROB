import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";

const connection = process.env.DATABASE_URL;

if (!connection) {
  throw new Error("DATABASE_URL no definida.");
}

const url = new URL(connection);

if (
  decodeURIComponent(
    url.pathname.replace(/^\/+/, "")
  ) !== "pos_novnix"
) {
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

const entities = [
  ["venta", "venta", false],
  ["devolucion_venta", "devolucion_venta", false],
  ["compra", "compra", false],
  ["cotizacion", "cotizacion", false],
  ["orden_venta", "orden_venta", false],
  ["pedido_cliente", "pedido_cliente", false],
  ["ajuste_inventario", "ajuste_inventario", false],
  ["transferencia_almacen", "transferencia_almacen", false],
  ["cliente", "cliente", true],
  ["cliente_direccion", "cliente_direccion", true],
  ["proveedor", "proveedor", true],
  ["proveedor_direccion", "proveedor_direccion", true],
  ["empresa", "empresa", true],
  ["sucursal", "sucursal", true],
  ["almacen", "almacen", true],
  ["usuario_sucursal", "sucursal", true],
  ["caja", "caja", false],
  ["sesion_caja", "sesion_caja", false],
  ["movimiento_caja", "movimiento_caja", false],
  [
    "sincronizacion_ecommerce_inventario",
    "sincronizacion_ecommerce_inventario",
    false
  ]
];

test("M14: cobertura real de entidades en solo lectura", async t => {
  const { prisma } =
    await import("../../../lib/prisma.ts");

  const { Prisma } =
    await import(
      "../../../generated/prisma/client.ts"
    );

  const { auditSourceFor } =
    await import(
      "../repositories/audit-targets.ts"
    );

  const { auditScope } =
    await import(
      "../repositories/audit.repository.ts"
    );

  try {
    const check = await prisma.$queryRaw`
      SELECT
        current_database() AS database,
        current_setting(
          'transaction_read_only'
        ) AS readonly
    `;

    assert.equal(check[0]?.database, "pos_novnix");
    assert.equal(check[0]?.readonly, "on");

    const originalTotal = await prisma.auditoria.count();

    const actorUser = await prisma.usuario.findFirst({
      where: {
        activo: true,
        bloqueado: false,
        empresa: { activo: true }
      },
      select: {
        id: true,
        empresa_id: true
      }
    });

    assert.ok(actorUser, "No existe usuario activo.");

    const actor = {
      userId: actorUser.id,
      empresaId: actorUser.empresa_id
    };

    let verified = 0;
    let pending = 0;

    for (const [entity, table, adminOnly] of entities) {
      await t.test(`Entidad: ${entity}`, async t => {
        // Los identificadores de tablas proceden
        // exclusivamente de la lista fija anterior.
        const sample = await prisma.$queryRaw(
          Prisma.sql`
            SELECT id
            FROM ${Prisma.raw(`pos."${table}"`)}
            ORDER BY id
            LIMIT 1
          `
        );

        if (!sample.length) {
          pending++;
          t.skip(
            "No existen documentos para validar esta entidad."
          );
          return;
        }

        const recordId = sample[0].id;

        /*
         * Evento virtual: SELECT parametrizado.
         * No se inserta en pos.auditoria.
         */
        const virtualRelation = Prisma.sql`(
          SELECT
            1::bigint AS id,
            ${actor.userId}::bigint AS usuario_id,
            ${entity}::text AS tabla,
            ${recordId}::bigint AS registro_id,
            'INSERT'::text AS accion,
            CURRENT_TIMESTAMP AS creado_en
        )`;

        const source = auditSourceFor(virtualRelation);

        const resolved = await prisma.$queryRaw(
          Prisma.sql`
            SELECT
              target.empresa_id,
              target.sucursal_id,
              target.sucursal_destino_id,
              target.solo_admin
            ${source}
          `
        );

        assert.equal(
          resolved.length,
          1,
          `${entity}: documento sin atribucion verificable.`
        );

        const target = resolved[0];

        assert.equal(
          target.solo_admin,
          adminOnly,
          `${entity}: politica de administrador incorrecta.`
        );

        const belongsToActor =
          target.empresa_id === actor.empresaId;

        const adminAccess = {
          empresaId: actor.empresaId,
          global: true,
          sucursalIds: []
        };

        const scopedAdmin = await prisma.$queryRaw(
          Prisma.sql`
            SELECT COUNT(*) AS total
            ${source}
            ${auditScope(actor, adminAccess)}
          `
        );

        assert.equal(
          scopedAdmin[0].total,
          belongsToActor ? 1n : 0n
        );

        const allowedBranches = [
          target.sucursal_id,
          target.sucursal_destino_id
        ].filter(value => value !== null);

        const branchAccess = {
          empresaId: actor.empresaId,
          global: false,
          sucursalIds: allowedBranches
        };

        const scopedBranch = await prisma.$queryRaw(
          Prisma.sql`
            SELECT COUNT(*) AS total
            ${source}
            ${auditScope(actor, branchAccess)}
          `
        );

        const expectedBranch =
          belongsToActor &&
          !adminOnly &&
          allowedBranches.length > 0
            ? 1n
            : 0n;

        assert.equal(
          scopedBranch[0].total,
          expectedBranch
        );

        const denied = await prisma.$queryRaw(
          Prisma.sql`
            SELECT COUNT(*) AS total
            ${source}
            ${auditScope(actor, {
              empresaId: actor.empresaId,
              global: false,
              sucursalIds: []
            })}
          `
        );

        assert.equal(denied[0].total, 0n);

        if (
          entity === "transferencia_almacen" &&
          belongsToActor &&
          target.sucursal_id !==
            target.sucursal_destino_id
        ) {
          const partial = await prisma.$queryRaw(
            Prisma.sql`
              SELECT COUNT(*) AS total
              ${source}
              ${auditScope(actor, {
                empresaId: actor.empresaId,
                global: false,
                sucursalIds: [target.sucursal_id]
              })}
            `
          );

          assert.equal(
            partial[0].total,
            0n,
            "Transferencia visible sin acceso al destino."
          );
        }

        verified++;

        console.log({
          entidad: entity,
          empresa: target.empresa_id.toString(),
          alcance: adminOnly
            ? "ADMIN"
            : "SUCURSAL",
          resultado: "PASS"
        });
      });
    }

    const after = await prisma.auditoria.count();

    assert.equal(after, originalTotal);

    assert.ok(
      verified > 0,
      "No se valido ninguna entidad."
    );

    console.log("\n=== RESUMEN DE COBERTURA ===");

    console.log({
      entidades_configuradas: entities.length,
      entidades_verificadas: verified,
      pendientes_sin_documentos: pending,
      historial_antes: originalTotal,
      historial_despues: after,
      base_de_datos: "pos_novnix"
    });

  } finally {
    await prisma.$disconnect();
  }
});
