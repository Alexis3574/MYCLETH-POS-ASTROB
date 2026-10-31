import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { getRetryPolicy, retryDelayMs, retryDue } from "./inventory-sync.retry-policy.js";

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
    const policy = getRetryPolicy();
    const now = Date.now();
    const due = [];

    for (let n = 0; n < policy.maxAttempts; n++) {
      if (n === 0) {
        due.push({ intentos: 0 });
      } else {
        due.push({
          intentos: n,
          OR: [
            { ultimo_intento_en: null },
            {
              ultimo_intento_en: {
                lte: new Date(now - retryDelayMs(n, policy))
              }
            }
          ]
        });
      }
    }

    return prisma.sincronizacion_ecommerce_inventario.findMany({
      where: {
        OR: [
          { estado: "PENDIENTE", OR: due },
          { estado: "REINTENTO_MANUAL" }
        ]
      },
      orderBy: [{ creado_en: "asc" }, { id: "asc" }],
      take: limit
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
    const policy = getRetryPolicy();

    return prisma.$transaction(async tx => {
      const current =
        await tx.sincronizacion_ecommerce_inventario.findUnique({
          where: { id },
          select: {
            estado: true,
            intentos: true,
            ultimo_intento_en: true
          }
        });

      const now = new Date();

      if (
        !current ||
        !["PENDIENTE", "REINTENTO_MANUAL"].includes(current.estado) ||
        current.intentos < 0 ||
        (current.estado === "PENDIENTE" &&
          !retryDue(current.intentos, current.ultimo_intento_en, now, policy))
      ) {
        return { count: 0 as const };
      }

      const updated =
        await tx.sincronizacion_ecommerce_inventario.updateMany({
          where: {
            id,
            estado: current.estado,
            intentos: current.intentos
          },
          data: {
            estado: current.estado === "REINTENTO_MANUAL"
              ? "PROCESANDO_MANUAL" : "PROCESANDO",
            intentos: { increment: 1 },
            ultimo_intento_en: now
          }
        });

      if (updated.count !== 1) {
        return { count: 0 as const };
      }

      return {
        count: 1 as const,
        attempts: current.intentos + 1,
        mode: current.estado === "REINTENTO_MANUAL"
          ? "MANUAL" as const : "AUTO" as const
      };
    });
  },

  async markExhaustedPending() {
    const policy = getRetryPolicy();

    return prisma.sincronizacion_ecommerce_inventario.updateMany({
      where: {
        estado: "PENDIENTE",
        intentos: { gte: policy.maxAttempts }
      },
      data: { estado: "AGOTADO" }
    });
  },

  async requeueStaleProcessing(staleBefore: Date) {
    const policy = getRetryPolicy();

    const stale = {
      estado: "PROCESANDO",
      OR: [
        { ultimo_intento_en: { lt: staleBefore } },
        { ultimo_intento_en: null }
      ]
    } satisfies Prisma.sincronizacion_ecommerce_inventarioWhereInput;

    const exhausted =
      await prisma.sincronizacion_ecommerce_inventario.updateMany({
        where: {
          AND: [
            stale,
            { intentos: { gte: policy.maxAttempts } }
          ]
        },
        data: { estado: "AGOTADO" }
      });

    const requeued =
      await prisma.sincronizacion_ecommerce_inventario.updateMany({
        where: {
          AND: [
            stale,
            { intentos: { lt: policy.maxAttempts } }
          ]
        },
        data: { estado: "PENDIENTE" }
      });

    const manualTimeout =
      await prisma.sincronizacion_ecommerce_inventario.updateMany({
        where: {
          estado: "PROCESANDO_MANUAL",
          OR: [
            { ultimo_intento_en: { lt: staleBefore } },
            { ultimo_intento_en: null }
          ]
        },
        data: { estado: "AGOTADO" }
      });

    return {
      count: exhausted.count + requeued.count + manualTimeout.count,
      exhausted: exhausted.count + manualTimeout.count,
      requeued: requeued.count
    };
  },

  async markSynchronized(
    id: bigint,
    ecommerceProductId: bigint,
    expectedAttempts: number,
    mode: "AUTO" | "MANUAL"
  ) {
    return prisma.sincronizacion_ecommerce_inventario.updateMany({
      where: {
        id,
        estado: mode === "MANUAL" ? "PROCESANDO_MANUAL" : "PROCESANDO",
        intentos: expectedAttempts
      },
      data: {
        ecommerce_product_id: ecommerceProductId,
        estado: "SINCRONIZADO",
        ultimo_error: null,
        sincronizado_en: new Date()
      }
    });
  },

  async markFailed(
    id: bigint,
    errorMessage: string,
    expectedAttempts: number,
    mode: "AUTO" | "MANUAL"
  ) {
    return prisma.sincronizacion_ecommerce_inventario.updateMany({
      where: {
        id,
        estado: mode === "MANUAL" ? "PROCESANDO_MANUAL" : "PROCESANDO",
        intentos: expectedAttempts
      },
      data: {
        estado: mode === "MANUAL" || expectedAttempts >= getRetryPolicy().maxAttempts
          ? "AGOTADO"
          : "PENDIENTE",
        ultimo_error: errorMessage
      }
    });
  },

};