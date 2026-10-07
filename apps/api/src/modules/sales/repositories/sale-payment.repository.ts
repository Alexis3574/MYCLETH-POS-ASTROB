import type {
  CreateCashMovementData,
  CreateSalePaymentData,
  SaleTransaction,
} from "../types/sales.types.js";

export const salePaymentRepository = {
  async findPaymentMethod(
    tx: SaleTransaction,
    paymentMethodId: bigint,
  ) {
    return tx.metodo_pago.findFirst({
      where: {
        id: paymentMethodId,
        activo: true,
      },
      select: {
        id: true,
        codigo: true,
        nombre: true,
        es_efectivo: true,
        activo: true,
      },
    });
  },

  async createSalePayment(
    tx: SaleTransaction,
    data: CreateSalePaymentData,
  ) {
    return tx.venta_pago.create({
      data: {
        venta_id: data.venta_id,
        metodo_pago_id:
          data.metodo_pago_id,

        sesion_caja_id:
          data.sesion_caja_id ?? null,

        monto: data.monto,

        referencia:
          data.referencia ?? null,
      },
      select: {
        id: true,
        venta_id: true,
        metodo_pago_id: true,
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
          data.tipo,

        concepto:
          data.concepto,

        monto:
          data.monto,

        referencia:
          data.referencia ?? null,
      },
      select: {
        id: true,
        sesion_caja_id: true,
        usuario_id: true,
        tipo: true,
        concepto: true,
        monto: true,
        referencia: true,
        fecha: true,
      },
    });
  },
};