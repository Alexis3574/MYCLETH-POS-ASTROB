import {
  SaleReturnContextError,
  SaleReturnDuplicatePaymentError,
  SaleReturnPaymentError,
  SaleReturnPaymentExceededError,
  SaleReturnPaymentTotalMismatchError,
} from "../errors/sale-return.errors.js";

import {
  saleReturnPaymentRepository,
} from "../repositories/sale-return-payment.repository.js";

import type {
  LockedReturnSale,
} from "../repositories/sale-return.repository.js";

import type {
  SaleReturnRefundInput,
} from "../types/sale-return.types.js";

import type {
  SaleTransaction,
} from "../../types/sales.types.js";

import {
  decimalToNumber,
  moneyToCents,
  roundMoney,
} from "../../utils/sale-money.js";

type SalePayment =
  LockedReturnSale["venta_pago"][number];

export interface PreparedReturnRefund {
  salePayment:
    SalePayment;

  monto:
    number;

  referencia:
    string | null;

  sesionCajaId:
    bigint | null;
}

export async function prepareReturnRefunds(
  tx: SaleTransaction,
  sale: LockedReturnSale,
  usuarioId: bigint,
  sesionCajaId: bigint | null | undefined,
  refunds: SaleReturnRefundInput[],
  returnTotal: number,
) {
  const prepared:
    PreparedReturnRefund[] = [];

  const usedIds =
    new Set<string>();

  let hasCashRefund =
    false;

  for (
    const refund of
    refunds
  ) {
    const key =
      refund.salePaymentId.toString();

    if (
      usedIds.has(
        key,
      )
    ) {
      throw new SaleReturnDuplicatePaymentError(
        refund.salePaymentId,
      );
    }

    usedIds.add(
      key,
    );

    const salePayment =
      sale.venta_pago.find(
        (payment) =>
          payment.id ===
          refund.salePaymentId,
      );

    if (!salePayment) {
      throw new SaleReturnPaymentError(
        refund.salePaymentId,
      );
    }

    const originalAmount =
      roundMoney(
        decimalToNumber(
          salePayment.monto,
        ),
      );

    const previous =
      await saleReturnPaymentRepository
        .getRefundedAmount(
          tx,
          salePayment.id,
        );

    const alreadyRefunded =
      roundMoney(
        decimalToNumber(
          previous._sum.monto ??
          0,
        ),
      );

    const availableCents =
      moneyToCents(
        originalAmount,
      ) -
      moneyToCents(
        alreadyRefunded,
      );

    const requestedAmount =
      roundMoney(
        refund.monto,
      );

    const requestedCents =
      moneyToCents(
        requestedAmount,
      );

    if (
      requestedCents >
      availableCents
    ) {
      throw new SaleReturnPaymentExceededError(
        salePayment.id,
        originalAmount,
        alreadyRefunded,
        requestedAmount,
        availableCents /
          100,
      );
    }

    if (
      salePayment.metodo_pago
        .es_efectivo
    ) {
      hasCashRefund =
        true;
    }

    prepared.push({
      salePayment,

      monto:
        requestedAmount,

      referencia:
        refund.referencia ??
        null,

      sesionCajaId:
        null,
    });
  }

  const refundTotalCents =
    prepared.reduce(
      (
        total,
        refund,
      ) =>
        total +
        moneyToCents(
          refund.monto,
        ),
      0,
    );

  const returnTotalCents =
    moneyToCents(
      returnTotal,
    );

  if (
    refundTotalCents !==
    returnTotalCents
  ) {
    throw new SaleReturnPaymentTotalMismatchError(
      returnTotal,
      refundTotalCents /
        100,
    );
  }

  if (!hasCashRefund) {
    return {
      preparedRefunds:
        prepared,
    };
  }

  if (
    sesionCajaId ===
      undefined ||
    sesionCajaId ===
      null
  ) {
    throw new SaleReturnContextError(
      "sesion_caja_id",
      "Un reembolso en efectivo requiere una sesión de caja abierta.",
    );
  }

  const cashSession =
    await saleReturnPaymentRepository
      .lockCashSession(
        tx,
        sesionCajaId,
      );

  if (!cashSession) {
    throw new SaleReturnContextError(
      "sesion_caja_id",
      "La sesión de caja indicada no existe.",
    );
  }

  if (
    cashSession.estado !==
      "ABIERTA" ||
    cashSession.fecha_cierre !==
      null
  ) {
    throw new SaleReturnContextError(
      "sesion_caja_id",
      "La sesión de caja indicada no se encuentra abierta.",
    );
  }

  if (
    !cashSession.caja.activo
  ) {
    throw new SaleReturnContextError(
      "sesion_caja_id",
      "La caja asociada se encuentra inactiva.",
    );
  }

  if (
    cashSession.caja
      .sucursal_id !==
    sale.sucursal_id
  ) {
    throw new SaleReturnContextError(
      "sesion_caja_id",
      "La sesión de caja no pertenece a la sucursal de la venta.",
    );
  }

  if (
    cashSession
      .usuario_apertura_id !==
    usuarioId
  ) {
    throw new SaleReturnContextError(
      "sesion_caja_id",
      "La sesión de caja no fue abierta por el usuario que registra la devolución.",
    );
  }

  return {
    preparedRefunds:
      prepared.map(
        (refund) => ({
          ...refund,

          sesionCajaId:
            refund.salePayment
              .metodo_pago
              .es_efectivo
              ? sesionCajaId
              : null,
        }),
      ),
  };
}