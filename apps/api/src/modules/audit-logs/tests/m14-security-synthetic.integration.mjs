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

test("M14: politicas SQL sinteticas de seguridad", async t => {
  const { prisma } =
    await import("../../../lib/prisma.ts");

  const { Prisma } =
    await import("../../../generated/prisma/client.ts");

  const { auditScope } =
    await import("../repositories/audit.repository.ts");

  const { auditSourceFor } =
    await import("../repositories/audit-targets.ts");

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

    const before = await prisma.auditoria.count();

    const user = await prisma.usuario.findFirst({
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

    assert.ok(user, "No existe un usuario activo.");

    const actor = {
      userId: user.id,
      empresaId: user.empresa_id
    };

    const company = actor.empresaId;
    const otherCompany = company + 1n;

    function syntheticSource(target) {
      return Prisma.sql`
        FROM (
          SELECT
            ${actor.userId}::bigint AS usuario_id,
            1::bigint AS id,
            'transferencia_almacen'::text AS tabla,
            1::bigint AS registro_id,
            'INSERT'::text AS accion,
            CURRENT_TIMESTAMP AS creado_en
        ) a
        INNER JOIN pos.usuario u
          ON u.id = a.usuario_id
        INNER JOIN (
          SELECT
            ${target.empresa}::bigint AS empresa_id,
            ${target.sucursal}::bigint AS sucursal_id,
            ${target.destino}::bigint AS sucursal_destino_id,
            ${target.soloAdmin}::boolean AS solo_admin
        ) target ON TRUE
      `;
    }

    async function scopedCount(source, queryActor, access) {
      const rows = await prisma.$queryRaw(
        Prisma.sql`
          SELECT COUNT(*) AS total
          ${source}
          ${auditScope(queryActor, access)}
        `
      );

      return rows[0]?.total ?? 0n;
    }

    const examples = [
      {
        name: "Acceso a sucursal propia",
        target: {
          empresa: company,
          sucursal: 10n,
          destino: null,
          soloAdmin: false
        },
        global: false,
        sucursales: [10n],
        expected: 1n
      },
      {
        name: "Sucursal ajena denegada",
        target: {
          empresa: company,
          sucursal: 10n,
          destino: null,
          soloAdmin: false
        },
        global: false,
        sucursales: [20n],
        expected: 0n
      },
      {
        name: "Sin sucursales denegado",
        target: {
          empresa: company,
          sucursal: 10n,
          destino: null,
          soloAdmin: false
        },
        global: false,
        sucursales: [],
        expected: 0n
      },
      {
        name: "Transferencia: solo origen denegada",
        target: {
          empresa: company,
          sucursal: 10n,
          destino: 20n,
          soloAdmin: false
        },
        global: false,
        sucursales: [10n],
        expected: 0n
      },
      {
        name: "Transferencia: solo destino denegada",
        target: {
          empresa: company,
          sucursal: 10n,
          destino: 20n,
          soloAdmin: false
        },
        global: false,
        sucursales: [20n],
        expected: 0n
      },
      {
        name: "Transferencia: ambas sucursales permitidas",
        target: {
          empresa: company,
          sucursal: 10n,
          destino: 20n,
          soloAdmin: false
        },
        global: false,
        sucursales: [10n, 20n],
        expected: 1n
      },
      {
        name: "Entidad empresarial denegada a no ADMIN",
        target: {
          empresa: company,
          sucursal: 10n,
          destino: null,
          soloAdmin: true
        },
        global: false,
        sucursales: [10n],
        expected: 0n
      },
      {
        name: "Entidad empresarial visible para ADMIN",
        target: {
          empresa: company,
          sucursal: null,
          destino: null,
          soloAdmin: true
        },
        global: true,
        sucursales: [],
        expected: 1n
      },
      {
        name: "ADMIN no accede a empresa ajena",
        target: {
          empresa: otherCompany,
          sucursal: 10n,
          destino: null,
          soloAdmin: true
        },
        global: true,
        sucursales: [],
        expected: 0n
      },
      {
        name: "Sucursal ajena de otra empresa denegada",
        target: {
          empresa: otherCompany,
          sucursal: 10n,
          destino: null,
          soloAdmin: false
        },
        global: false,
        sucursales: [10n],
        expected: 0n
      },
      {
        name: "Sin sucursal atribuible denegado",
        target: {
          empresa: company,
          sucursal: null,
          destino: null,
          soloAdmin: false
        },
        global: false,
        sucursales: [10n],
        expected: 0n
      }
    ];

    for (const example of examples) {
      await t.test(example.name, async () => {
        const source = syntheticSource(example.target);

        const result = await scopedCount(
          source,
          actor,
          {
            empresaId: actor.empresaId,
            global: example.global,
            sucursalIds: example.sucursales
          }
        );

        assert.equal(result, example.expected);
      });
    }

    await t.test(
      "Empresa del JWT distinta a la del usuario",
      async () => {
        const source = syntheticSource({
          empresa: company,
          sucursal: 10n,
          destino: null,
          soloAdmin: false
        });

        const result = await scopedCount(
          source,
          {
            userId: actor.userId,
            empresaId: otherCompany
          },
          {
            empresaId: otherCompany,
            global: true,
            sucursalIds: []
          }
        );

        assert.equal(result, 0n);
      }
    );

    function virtualAudit(table, recordId) {
      return Prisma.sql`(
        SELECT
          1::bigint AS id,
          ${actor.userId}::bigint AS usuario_id,
          ${table}::text AS tabla,
          ${recordId}::bigint AS registro_id,
          'INSERT'::text AS accion,
          CURRENT_TIMESTAMP AS creado_en
      )`;
    }

    await t.test(
      "Entidad no configurada permanece oculta",
      async () => {
        const source = auditSourceFor(
          virtualAudit("entidad_no_autorizada", 1n)
        );

        const total = await scopedCount(
          source,
          actor,
          {
            empresaId: company,
            global: true,
            sucursalIds: []
          }
        );

        assert.equal(total, 0n);
      }
    );

    await t.test(
      "Documento inexistente permanece oculto",
      async () => {
        const source = auditSourceFor(
          virtualAudit(
            "venta",
            9223372036854775807n
          )
        );

        const total = await scopedCount(
          source,
          actor,
          {
            empresaId: company,
            global: true,
            sucursalIds: []
          }
        );

        assert.equal(total, 0n);
      }
    );

    const after = await prisma.auditoria.count();

    assert.equal(after, before);

    console.log("\n=== SEGURIDAD M14 ===");
    console.log({
      escenarios_sinteticos: examples.length + 3,
      auditorias_antes: before,
      auditorias_despues: after,
      modificaciones_postgresql: false
    });

  } finally {
    await prisma.$disconnect();
  }
});
