import { SaleContextError } from '../errors/sale.errors.js';
import { replaySale, nextSaleFolio, storeSaleOperation } from './create/sale-operation.js';
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
    input = { ...input, claveIdempotencia: input.claveIdempotencia?.toLowerCase() };
    if (!input.folio && !input.claveIdempotencia) throw new SaleContextError('clave_idempotencia', 'El folio automático requiere un identificador de intento.');
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
        const replay = await replaySale(tx, input);
        if (replay) return replay as Awaited<ReturnType<typeof persistCompletedSale>>;
        await validateSaleContext(tx, input);

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

        const resolvedInput = { ...input, folio: input.folio || await nextSaleFolio(tx, input) };
        const result = await persistCompletedSale({
          tx,
          input: resolvedInput,
          preparedDetails,
          preparedPayments,
          condicionPago,
          totals,
        });
        await storeSaleOperation(tx, input, result);
        return result;
      },
    );
  },
};