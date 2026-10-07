import { prisma } from "../../../lib/prisma.js";

import type {
  CreateSaleData,
  CreateSaleDetailData,
  SaleTransaction,
} from "../types/sales.types.js";

interface LockedSaleRow {
  id: bigint;
}

export const saleWriteRepository = {
  async transaction<T>(
    callback: (
      tx: SaleTransaction,
    ) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(
      callback,
    );
  },

  async createSale(
    tx: SaleTransaction,
    data: CreateSaleData,
  ) {
    return tx.venta.create({
      data,
    });
  },

  async createDetail(
    tx: SaleTransaction,
    data: CreateSaleDetailData,
  ) {
    return tx.venta_detalle.create({
      data,
    });
  },

  async lockSaleForCancellation(
    tx: SaleTransaction,
    saleId: bigint,
  ) {
    const locked =
      await tx.$queryRaw<
        LockedSaleRow[]
      >`
        SELECT id
        FROM "pos"."venta"
        WHERE id = ${saleId}
        FOR UPDATE
      `;

    if (locked.length === 0) {
      return null;
    }

    return tx.venta.findUnique({
      where: {
        id: saleId,
      },
      select: {
        id: true,
        empresa_id: true,
        sucursal_id: true,
        almacen_id: true,
        usuario_id: true,
        sesion_caja_id: true,
        folio: true,
        estado: true,

        venta_detalle: {
          orderBy: {
            id: "asc",
          },
          select: {
            id: true,
            producto_id: true,
            cantidad: true,
            costo_unitario: true,

            producto: {
              select: {
                sku: true,
                codigo_barras: true,
              },
            },
          },
        },

        venta_pago: {
          orderBy: {
            id: "asc",
          },
          select: {
            id: true,
            metodo_pago_id: true,
            sesion_caja_id: true,
            monto: true,
            referencia: true,

            metodo_pago: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
                es_efectivo: true,
              },
            },
          },
        },
      },
    });
  },

  async completeSale(
    tx: SaleTransaction,
    saleId: bigint,
  ) {
    return tx.venta.update({
      where: {
        id: saleId,
      },
      data: {
        estado: "COMPLETADA",
        actualizado_en: new Date(),
      },
    });
  },

  async cancelSale(
    tx: SaleTransaction,
    saleId: bigint,
  ) {
    return tx.venta.update({
      where: {
        id: saleId,
      },
      data: {
        estado: "CANCELADA",
        actualizado_en: new Date(),
      },
    });
  },
};