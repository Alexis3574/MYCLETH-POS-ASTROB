import {
  SaleContextError,
  SaleCreditRequiresClientError,
  SalePaymentMethodError,
} from "../../errors/sale.errors.js";

import {
  salePaymentRepository,
} from "../../repositories/sale-payment.repository.js";

import type {
  CreateSaleInput,
  SaleTransaction,
} from "../../types/sales.types.js";

import {
  roundMoney,
} from "../../utils/sale-money.js";

type PaymentMethodForSale =
  NonNullable<
    Awaited<
      ReturnType<
        typeof salePaymentRepository.findPaymentMethod
      >
    >
  >;

export interface PreparedSalePayment {
  paymentMethod:
    PaymentMethodForSale;

  monto:
    number;

  referencia:
    string | null;
}

export interface PreparedPaymentsResult {
  preparedPayments:
    PreparedSalePayment[];

  condicionPago:
    "CONTADO" | "CREDITO";
}

export async function prepareSalePayments(
  tx: SaleTransaction,
  input: CreateSaleInput,
): Promise<PreparedPaymentsResult> {
  const preparedPayments:
    PreparedSalePayment[] = [];

  for (const payment of input.pagos) {
    const paymentMethod =
      await salePaymentRepository
        .findPaymentMethod(
          tx,
          payment.metodoPagoId,
        );

    if (!paymentMethod) {
      throw new SalePaymentMethodError(
        payment.metodoPagoId,
      );
    }

    const paymentAmount =
      roundMoney(
        payment.monto,
      );

    if (
      !Number.isFinite(
        paymentAmount,
      ) ||
      paymentAmount <= 0
    ) {
      throw new Error(
        "El monto del pago no es válido.",
      );
    }

    if (
      paymentMethod.es_efectivo &&
      (
        input.sesionCajaId === undefined ||
        input.sesionCajaId === null
      )
    ) {
      throw new SaleContextError(
        "sesion_caja_id",
        "Una venta pagada en efectivo requiere una sesión de caja abierta.",
      );
    }

    preparedPayments.push({
      paymentMethod,

      monto:
        paymentAmount,

      referencia:
        payment.referencia ??
        null,
    });
  }

  const hasCreditPayment =
    preparedPayments.some(
      (payment) =>
        payment.paymentMethod.codigo ===
        "CREDITO",
    );

  if (
    hasCreditPayment &&
    (
      input.clienteId === undefined ||
      input.clienteId === null
    )
  ) {
    throw new SaleCreditRequiresClientError();
  }

  const condicionPago:
    "CONTADO" | "CREDITO" =
      hasCreditPayment
        ? "CREDITO"
        : "CONTADO";

  return {
    preparedPayments,
    condicionPago,
  };
}
