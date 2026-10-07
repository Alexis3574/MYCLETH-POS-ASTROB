import {
  SalePaymentTotalMismatchError,
} from "../../errors/sale.errors.js";

import {
  moneyToCents,
  roundMoney,
} from "../../utils/sale-money.js";

import type {
  PreparedSaleDetail,
} from "./sale-detail.preparer.js";

import type {
  PreparedSalePayment,
} from "./sale-payment.preparer.js";

export interface SaleTotals {
  subtotal:
    number;

  descuento:
    number;

  impuesto:
    number;

  total:
    number;
}

export function calculateSaleTotals(
  preparedDetails:
    PreparedSaleDetail[],
): SaleTotals {
  const subtotal =
    roundMoney(
      preparedDetails.reduce(
        (
          accumulated,
          detail,
        ) =>
          accumulated +
          detail.subtotalLinea,
        0,
      ),
    );

  const descuento =
    roundMoney(
      preparedDetails.reduce(
        (
          accumulated,
          detail,
        ) =>
          accumulated +
          detail.descuentoImporte,
        0,
      ),
    );

  const impuesto =
    roundMoney(
      preparedDetails.reduce(
        (
          accumulated,
          detail,
        ) =>
          accumulated +
          detail.impuestoImporte,
        0,
      ),
    );

  const total =
    roundMoney(
      preparedDetails.reduce(
        (
          accumulated,
          detail,
        ) =>
          accumulated +
          detail.totalLinea,
        0,
      ),
    );

  return {
    subtotal,
    descuento,
    impuesto,
    total,
  };
}

export function validateSalePaymentTotal(
  preparedPayments:
    PreparedSalePayment[],

  saleTotal:
    number,
): void {
  const paymentTotalCents =
    preparedPayments.reduce(
      (
        accumulated,
        payment,
      ) =>
        accumulated +
        moneyToCents(
          payment.monto,
        ),
      0,
    );

  const saleTotalCents =
    moneyToCents(
      saleTotal,
    );

  if (
    paymentTotalCents ===
    saleTotalCents
  ) {
    return;
  }

  throw new SalePaymentTotalMismatchError(
    saleTotal,
    paymentTotalCents /
      100,
  );
}