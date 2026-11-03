import type { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../../lib/prisma.js";
import { env } from "../../../config/env.js";
import type { SyncListQuery } from "../ecommerce-sync.schema.js";

export type SyncActor = {
  empresaId: bigint;
  userId: bigint;
};

export class EcommerceSyncError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "EcommerceSyncError";
  }
}

const rowSelect = {
  id: true,
  movimiento_inventario_id: true,
  operation_id: true,
  sku: true,
  adjustment: true,
  ecommerce_product_id: true,
  estado: true,
  intentos: true,
  ultimo_error: true,
  creado_en: true,
  ultimo_intento_en: true,
  sincronizado_en: true,
  movimiento_inventario: {
    select: {
      id: true,
      tipo: true,
      fecha: true,
      producto: {
        select: {
          id: true,
          nombre: true
        }
      },
      almacen: {
        select: {
          id: true,
          nombre: true,
          sucursal: {
            select: {
              id: true,
              nombre: true
            }
          }
        }
      }
    }
  }
} as const;

type SyncRow =
  Prisma.sincronizacion_ecommerce_inventarioGetPayload<{
    select: typeof rowSelect
  }>;

function serialize(row: SyncRow) {
  return {
    id: row.id.toString(),
    movimiento_inventario_id:
      row.movimiento_inventario_id.toString(),
    operation_id: row.operation_id,
    sku: row.sku,
    adjustment: row.adjustment,
    ecommerce_product_id:
      row.ecommerce_product_id?.toString() ?? null,
    estado: row.estado,
    intentos: row.intentos,
    tiene_error: row.ultimo_error !== null,
    creado_en: row.creado_en.toISOString(),
    ultimo_intento_en:
      row.ultimo_intento_en?.toISOString() ?? null,
    sincronizado_en:
      row.sincronizado_en?.toISOString() ?? null,
    movimiento: {
      id: row.movimiento_inventario.id.toString(),
      tipo: row.movimiento_inventario.tipo,
      fecha: row.movimiento_inventario.fecha.toISOString(),
      producto: {
        id: row.movimiento_inventario.producto.id.toString(),
        nombre: row.movimiento_inventario.producto.nombre
      },
      almacen: {
        id: row.movimiento_inventario.almacen.id.toString(),
        nombre: row.movimiento_inventario.almacen.nombre
      },
      sucursal: {
        id: row.movimiento_inventario.almacen.sucursal.id.toString(),
        nombre: row.movimiento_inventario.almacen.sucursal.nombre
      }
    }
  };
}

async function verifyActor(actor: SyncActor) {
  const user = await prisma.usuario.findFirst({
    where: {
      id: actor.userId,
      empresa_id: actor.empresaId,
      activo: true,
      bloqueado: false,
      empresa: { activo: true }
    },
    select: { id: true }
  });

  if (!user) {
    throw new EcommerceSyncError(
      403,
      "ECOMMERCE_SYNC_FORBIDDEN",
      "Usuario no autorizado."
    );
  }
}

async function verifyBranch(
  actor: SyncActor,
  branchId: bigint
) {
  const branch = await prisma.sucursal.findFirst({
    where: {
      id: branchId,
      empresa_id: actor.empresaId,
      usuario_sucursal: {
        some: { usuario_id: actor.userId }
      }
    },
    select: { id: true }
  });

  if (!branch) {
    throw new EcommerceSyncError(
      404,
      "ECOMMERCE_SYNC_NOT_FOUND",
      "Sucursal no encontrada."
    );
  }
}

function scope(
  actor: SyncActor
): Prisma.sincronizacion_ecommerce_inventarioWhereInput {
  return {
    movimiento_inventario: {
      is: {
        producto: {
          is: { empresa_id: actor.empresaId }
        },
        almacen: {
          is: {
            sucursal: {
              is: {
                empresa_id: actor.empresaId,
                usuario_sucursal: {
                  some: { usuario_id: actor.userId }
                }
              }
            }
          }
        }
      }
    }
  };
}

function listWhere(
  actor: SyncActor,
  query: SyncListQuery
): Prisma.sincronizacion_ecommerce_inventarioWhereInput {
  const conditions:
    Prisma.sincronizacion_ecommerce_inventarioWhereInput[] = [
      scope(actor)
    ];

  if (query.estado) {
    conditions.push({ estado: query.estado });
  }

  if (query.sucursal_id) {
    conditions.push({
      movimiento_inventario: {
        is: {
          almacen: {
            is: { sucursal_id: query.sucursal_id }
          }
        }
      }
    });
  }

  if (query.sku) {
    conditions.push({
      sku: {
        contains: query.sku,
        mode: "insensitive"
      }
    });
  }

  if (query.fecha_desde || query.fecha_hasta) {
    conditions.push({
      creado_en: {
        ...(query.fecha_desde
          ? { gte: query.fecha_desde } : {}),
        ...(query.fecha_hasta
          ? { lte: query.fecha_hasta } : {})
      }
    });
  }

  return { AND: conditions };
}

export const ecommerceSyncService = {
  async list(actor: SyncActor, query: SyncListQuery) {
    await verifyActor(actor);

    if (query.sucursal_id) {
      await verifyBranch(actor, query.sucursal_id);
    }

    const where = listWhere(actor, query);

    const [items, total] = await prisma.$transaction([
      prisma.sincronizacion_ecommerce_inventario.findMany({
        where,
        select: rowSelect,
        orderBy: [
          { creado_en: "desc" },
          { id: "desc" }
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      prisma.sincronizacion_ecommerce_inventario.count({
        where
      })
    ]);

    return {
      items: items.map(serialize),
      total,
      page: query.page,
      pageSize: query.pageSize
    };
  },

  async get(actor: SyncActor, id: bigint) {
    await verifyActor(actor);

    const row = await prisma.sincronizacion_ecommerce_inventario
      .findFirst({
        where: {
          AND: [scope(actor), { id }]
        },
        select: rowSelect
      });

    if (!row) {
      throw new EcommerceSyncError(
        404,
        "ECOMMERCE_SYNC_NOT_FOUND",
        "Evento no encontrado."
      );
    }

    return serialize(row);
  },

  async summary(actor: SyncActor) {
    await verifyActor(actor);

    const groups = await prisma.sincronizacion_ecommerce_inventario
      .groupBy({
        by: ["estado"],
        where: scope(actor),
        _count: { _all: true },
        _max: { intentos: true },
        orderBy: { estado: "asc" }
      });

    return {
      total: groups.reduce(
        (sum, group) => sum + group._count._all,
        0
      ),
      estados: groups.map(group => ({
        estado: group.estado,
        total: group._count._all,
        max_intentos: group._max.intentos ?? 0
      }))
    };
  },

  async diagnostics(actor: SyncActor) {
    await verifyActor(actor);

    const where = scope(actor);

    const staleBefore = new Date(
      Date.now() - env.inventorySync.processingTimeoutMs
    );

    const [reintentosAltos, procesandoEstancados, maxIntentos] =
      await Promise.all([
        prisma.sincronizacion_ecommerce_inventario.count({
          where: {
            AND: [
              where,
              { intentos: { gte: 10 } }
            ]
          }
        }),
        prisma.sincronizacion_ecommerce_inventario.count({
          where: {
            AND: [
              where,
              {
                estado: "PROCESANDO",
                OR: [
                  { ultimo_intento_en: { lt: staleBefore } },
                  { ultimo_intento_en: null }
                ]
              }
            ]
          }
        }),
        prisma.sincronizacion_ecommerce_inventario.aggregate({
          where,
          _max: { intentos: true }
        })
      ]);

    return {
      umbral_reintentos_altos: 10,
      eventos_con_reintentos_altos: reintentosAltos,
      procesando_estancados: procesandoEstancados,
      max_intentos: maxIntentos._max.intentos ?? 0,
      processing_timeout_ms:
        env.inventorySync.processingTimeoutMs
    };
  }
};
