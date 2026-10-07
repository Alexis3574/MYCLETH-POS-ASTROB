import {
  prisma,
} from "../../../../lib/prisma.js";

import type {
  SaleTransaction,
} from "../../types/sales.types.js";

interface LockedSaleRow {
  id: bigint;
}

interface CreateReturnData {
  ventaId: bigint;
  usuarioId: bigint;
  sesionCajaId?: bigint | null;
  folio: string;
  motivo: string;
  subtotal: number;
  descuento: number;
  impuesto: number;
  total: number;
}

interface CreateReturnDetailData {
  devolucionVentaId: bigint;
  ventaDetalleId: bigint;
  cantidad: number;
  subtotalLinea: number;
  descuentoImporte: number;
  impuestoImporte: number;
  totalLinea: number;
}

export const saleReturnRepository = {
  async transaction<T>(
    callback: (
      tx: SaleTransaction,
    ) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(
      callback,
    );
  },

  async lockSaleForReturn(
    tx: SaleTransaction,
    saleId: bigint,
    empresaId: bigint,
  ) {
    const locked =
      await tx.$queryRaw<
        LockedSaleRow[]
      >`
        SELECT id
        FROM "pos"."venta"
        WHERE id = ${saleId}
          AND empresa_id = ${empresaId}
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
        cliente_id: true,
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
            precio_unitario: true,
            costo_unitario: true,
            subtotal_linea: true,
            descuento_importe: true,
            impuesto_importe: true,
            total_linea: true,

            producto: {
              select: {
                id: true,
                sku: true,
                codigo_barras: true,
                nombre: true,
                controla_inventario:
                  true,
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

  async getReturnedDetailTotals(
    tx: SaleTransaction,
    saleDetailId: bigint,
  ) {
    return tx.devolucion_venta_detalle.aggregate({
      where: {
        venta_detalle_id:
          saleDetailId,
      },

      _sum: {
        cantidad: true,
        subtotal_linea: true,
        descuento_importe: true,
        impuesto_importe: true,
        total_linea: true,
      },
    });
  },

  async createReturn(
    tx: SaleTransaction,
    data: CreateReturnData,
  ) {
    return tx.devolucion_venta.create({
      data: {
        venta_id:
          data.ventaId,

        usuario_id:
          data.usuarioId,

        sesion_caja_id:
          data.sesionCajaId ??
          null,

        folio:
          data.folio,

        motivo:
          data.motivo,

        subtotal:
          data.subtotal,

        descuento:
          data.descuento,

        impuesto:
          data.impuesto,

        total:
          data.total,
      },

      select: {
        id: true,
        venta_id: true,
        folio: true,
        motivo: true,
        subtotal: true,
        descuento: true,
        impuesto: true,
        total: true,
        fecha: true,
      },
    });
  },

  async createReturnDetail(
    tx: SaleTransaction,
    data: CreateReturnDetailData,
  ) {
    return tx.devolucion_venta_detalle.create({
      data: {
        devolucion_venta_id:
          data.devolucionVentaId,

        venta_detalle_id:
          data.ventaDetalleId,

        cantidad:
          data.cantidad,

        subtotal_linea:
          data.subtotalLinea,

        descuento_importe:
          data.descuentoImporte,

        impuesto_importe:
          data.impuestoImporte,

        total_linea:
          data.totalLinea,
      },

      select: {
        id: true,
        devolucion_venta_id: true,
        venta_detalle_id: true,
        cantidad: true,
        subtotal_linea: true,
        descuento_importe: true,
        impuesto_importe: true,
        total_linea: true,
      },
    });
  },
};

export type LockedReturnSale =
  NonNullable<
    Awaited<
      ReturnType<
        typeof saleReturnRepository.lockSaleForReturn
      >
    >
  >;