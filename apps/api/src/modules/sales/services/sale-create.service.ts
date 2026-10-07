import {
  saleWriteRepository,
} from "../repositories/sale.repository.js";

import type {
  CreateSaleInput,
} from "../types/sales.types.js";

import {
  validateSaleContext,
} from "./create/sale-context.validator.js";

import {
  prepareSaleDetails,
} from "./create/sale-detail.preparer.js";

import {
  prepareSalePayments,
} from "./create/sale-payment.preparer.js";

import {
  persistCompletedSale,
} from "./create/sale-persistence.service.js";

import {
  validateSaleStock,
} from "./create/sale-stock.validator.js";

import {
  calculateSaleTotals,
  validateSalePaymentTotal,
} from "./create/sale-totals.js";

export const saleCreateService = {
  async createSale(
    input: CreateSaleInput,
  ) {
    if (
      input.detalles.length ===
      0
    ) {
      throw new Error(
        "La venta debe contener al menos un producto.",
      );
    }

    if (
      input.pagos.length ===
      0
    ) {
      throw new Error(
        "La venta debe contener al menos un pago.",
      );
    }

    return saleWriteRepository.transaction(
      async (tx) => {
        await validateSaleContext(
          tx,
          input,
        );

        const {
          preparedPayments,
          condicionPago,
        } =
          await prepareSalePayments(
            tx,
            input,
          );

        const {
          preparedDetails,
          requiredStock,
        } =
          await prepareSaleDetails(
            tx,
            input,
          );

        await validateSaleStock(
          tx,
          input.almacenId,
          requiredStock,
        );

        const totals =
          calculateSaleTotals(
            preparedDetails,
          );

        validateSalePaymentTotal(
          preparedPayments,
          totals.total,
        );

        return persistCompletedSale({
          tx,
          input,
          preparedDetails,
          preparedPayments,
          condicionPago,
          totals,
        });
      },
    );
  },
};