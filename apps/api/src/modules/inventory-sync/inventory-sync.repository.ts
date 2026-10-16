import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

type DbClient =
  | Prisma.TransactionClient
  | typeof prisma;

interface CreatePendingSyncData {
  movimientoInventarioId: bigint;
  operationId: string;
  codigoBarras: string | null;
  sku: string;
  adjustment: number;
}

export const inventorySyncRepository = {
  async createPending(
    data: CreatePendingSyncData,
    db: DbClient = prisma,
  ) {
    return db.sincronizacion_ecommerce_inventario.create({
      data: {
        movimiento_inventario_id:
          data.movimientoInventarioId,

        operation_id:
          data.operationId,

        codigo_barras:
          data.codigoBarras,

        sku:
          data.sku,

        adjustment:
          data.adjustment,

        estado:
          "PENDIENTE",
      },
    });
  },

  async findPending(limit = 20) {
    return prisma.sincronizacion_ecommerce_inventario.findMany({
      where: {
        estado: "PENDIENTE",
      },

      orderBy: {
        creado_en: "asc",
      },

      take: limit,
    });
  },

  async findById(id: bigint) {
    return prisma.sincronizacion_ecommerce_inventario.findUnique({
      where: {
        id,
      },
    });
  },

  async tryClaim(id: bigint) {
    return prisma.sincronizacion_ecommerce_inventario.updateMany({
      where: {
        id,
        estado: "PENDIENTE",
      },

      data: {
        estado: "PROCESANDO",

        intentos: {
          increment: 1,
        },

        ultimo_intento_en:
          new Date(),
      },
    });
  },

  async requeueStaleProcessing(
    staleBefore: Date,
  ) {
    return prisma.sincronizacion_ecommerce_inventario.updateMany({
      where: {
        estado: "PROCESANDO",

        ultimo_intento_en: {
          lt: staleBefore,
        },
      },

      data: {
        estado: "PENDIENTE",
      },
    });
  },

  async markSynchronized(
    id: bigint,
    ecommerceProductId: bigint,
  ) {
    return prisma.sincronizacion_ecommerce_inventario.update({
      where: {
        id,
      },

      data: {
        ecommerce_product_id:
          ecommerceProductId,

        estado:
          "SINCRONIZADO",

        ultimo_error:
          null,

        sincronizado_en:
          new Date(),
      },
    });
  },

  async markFailed(
    id: bigint,
    errorMessage: string,
  ) {
    return prisma.sincronizacion_ecommerce_inventario.update({
      where: {
        id,
      },

      data: {
        estado:
          "PENDIENTE",

        ultimo_error:
          errorMessage,
      },
    });
  },
};