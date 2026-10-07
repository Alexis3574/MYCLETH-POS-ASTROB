import type {
  SaleTransaction,
} from "../../types/sales.types.js";

interface LockedCashSessionRow {
  id: bigint;
}

interface CreateRefundData {
  devolucionVentaId: bigint;
  ventaPagoId: bigint;
  sesionCajaId?: bigint | null;
  monto: number;
  referencia?: string | null;
}

interface CreateCashMovementData {
  sesionCajaId: bigint;
  usuarioId: bigint;
  monto: number;
  concepto: string;
  referencia: string;
}

export const saleReturnPaymentRepository = {
  async getRefundedAmount(
    tx: SaleTransaction,
    salePaymentId: bigint,
  ) {
    return tx.devolucion_pago.aggregate({
      where: {
        venta_pago_id:
          salePaymentId,
      },

      _sum: {
        monto: true,
      },
    });
  },

  async lockCashSession(
    tx: SaleTransaction,
    cashSessionId: bigint,
  ) {
    const locked =
      await tx.$queryRaw<
        LockedCashSessionRow[]
      >`
        SELECT id
        FROM "pos"."sesion_caja"
        WHERE id = ${cashSessionId}
        FOR UPDATE
      `;

    if (locked.length === 0) {
      return null;
    }

    return tx.sesion_caja.findUnique({
      where: {
        id:
          cashSessionId,
      },

      select: {
        id: true,
        usuario_apertura_id:
          true,

        estado:
          true,

        fecha_cierre:
          true,

        caja: {
          select: {
            id: true,
            sucursal_id: true,
            activo: true,
          },
        },
      },
    });
  },

  async createRefund(
    tx: SaleTransaction,
    data: CreateRefundData,
  ) {
    return tx.devolucion_pago.create({
      data: {
        devolucion_venta_id:
          data.devolucionVentaId,

        venta_pago_id:
          data.ventaPagoId,

        sesion_caja_id:
          data.sesionCajaId ??
          null,

        monto:
          data.monto,

        referencia:
          data.referencia ??
          null,
      },

      select: {
        id: true,
        venta_pago_id: true,
        sesion_caja_id: true,
        monto: true,
        referencia: true,
        fecha: true,
      },
    });
  },

  async createCashMovement(
    tx: SaleTransaction,
    data: CreateCashMovementData,
  ) {
    return tx.movimiento_caja.create({
      data: {
        sesion_caja_id:
          data.sesionCajaId,

        usuario_id:
          data.usuarioId,

        tipo:
          "SALIDA",

        concepto:
          data.concepto,

        monto:
          data.monto,

        referencia:
          data.referencia,
      },

      select: {
        id: true,
      },
    });
  },
};