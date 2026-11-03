import "dotenv/config";

import test from "node:test";
import assert from "node:assert/strict";

const connection = process.env.DATABASE_URL;

if (!connection) {
  throw new Error("DATABASE_URL no definida.");
}

const parsed = new URL(connection);

const database = decodeURIComponent(
  parsed.pathname.replace(/^\/+/, "")
);

if (database !== "pos_novnix") {
  throw new Error("Conexion rechazada: base incorrecta.");
}

/*
 * Todas las conexiones creadas por este proceso
 * deben usar transacciones de solo lectura.
 */
const existingOptions = parsed.searchParams.get("options");

parsed.searchParams.set(
  "options",
  [
    existingOptions,
    "-c default_transaction_read_only=on"
  ].filter(Boolean).join(" ")
);

process.env.DATABASE_URL = parsed.toString();

test("M14: integracion real de solo lectura", async () => {
  const { prisma } =
    await import("../../../lib/prisma.js");

  const { auditService } =
    await import("../services/audit.service.js");

  const { auditListSchema } =
    await import("../validators/audit.schema.js");

  const { AuditNotFoundError } =
    await import("../errors/audit.errors.js");

  try {
    const configuration = await prisma.$queryRaw<
      Array<{ db: string; modo: string }>
    >`
      SELECT
        current_database() AS db,
        current_setting(
          'default_transaction_read_only'
        ) AS modo
    `;

    assert.equal(configuration[0]?.db, "pos_novnix");
    assert.equal(configuration[0]?.modo, "on");

    console.log("PostgreSQL: solo lectura confirmada.");

    const before = await prisma.auditoria.count();

    assert.ok(
      before >= 44,
      "No se encontraron los 44 eventos historicos esperados."
    );

    const historical = await prisma.auditoria.findFirst({
      where: {
        tabla: {
          in: ["venta", "devolucion_venta"]
        }
      },
      orderBy: [
        { creado_en: "desc" },
        { id: "desc" }
      ],
      select: {
        id: true,
        usuario: {
          select: {
            empresa_id: true
          }
        }
      }
    });

    assert.ok(historical);
    assert.ok(historical.usuario);

    const empresaId = historical.usuario.empresa_id;

    const admin = await prisma.usuario.findFirst({
      where: {
        empresa_id: empresaId,
        activo: true,
        bloqueado: false,
        usuario_rol: {
          some: {
            rol: {
              codigo: "ADMIN",
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

    assert.ok(
      admin,
      "No existe un usuario activo con rol ADMIN asignado."
    );

    const actor = {
      empresaId: admin.empresa_id,
      userId: admin.id
    };

    const query = auditListSchema.parse({
      page: "1",
      limit: "100"
    });

    console.log("\n=== CONSULTA ADMIN ===");

    const result = await auditService.list(actor, query);

    assert.ok(
      result.data.length > 0,
      "ADMIN no puede consultar los eventos existentes."
    );

    assert.ok(
      result.data.some(
        row => row.id === historical.id.toString()
      ),
      "No se encontro el evento historico esperado."
    );

    console.log({
      eventos_visibles: result.data.length,
      paginacion: result.pagination
    });

    console.log("\n=== DETALLE ===");

    const detail = await auditService.getById(
      actor,
      historical.id
    );

    assert.equal(
      detail.id,
      historical.id.toString()
    );

    assert.equal("ip_origen" in detail, false);

    assert.equal(
      "password_hash" in (detail.datos_nuevos ?? {}),
      false
    );

    console.log({
      evento_id: detail.id,
      tabla: detail.tabla,
      accion: detail.accion,
      detalle_autorizado: true
    });

    console.log("\n=== AISLAMIENTO ENTRE EMPRESAS ===");

    const foreignActor = {
      empresaId: 0n,
      userId: admin.id
    };

    const foreignResult = await auditService.list(
      foreignActor,
      query
    );

    assert.equal(foreignResult.data.length, 0);
    assert.equal(foreignResult.pagination.total, 0);

    await assert.rejects(
      () => auditService.getById(
        foreignActor,
        historical.id
      ),
      error => error instanceof AuditNotFoundError
    );

    console.log("Acceso entre empresas: DENEGADO.");

    console.log("\n=== USUARIO SIN ASIGNACIONES ===");

    const unknownActor = {
      empresaId,
      userId: 0n
    };

    const unknownResult = await auditService.list(
      unknownActor,
      query
    );

    assert.equal(unknownResult.data.length, 0);

    console.log("Acceso sin asignaciones: DENEGADO.");

    console.log("\n=== INTEGRIDAD HISTORICA ===");

    const after = await prisma.auditoria.count();

    assert.equal(after, before);

    console.log({
      eventos_antes: before,
      eventos_despues: after,
      historial_conservado: true
    });

  } finally {
    await prisma.$disconnect();
  }
});
