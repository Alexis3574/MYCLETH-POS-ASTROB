import {
  SaleReturnNotFoundError,
} from "../errors/sale-return.errors.js";

import {
  saleReturnRepository,
} from "../repositories/sale-return.repository.js";

import type {
  CreateSaleReturnInput,
} from "../types/sale-return.types.js";

import {
  validateSaleReturnContext,
} from "../validators/sale-return-context.validator.js";

import {
  prepareReturnItems,
} from "../validators/sale-return-items.validator.js";

import {
  prepareReturnRefunds,
} from "../validators/sale-return-payments.validator.js";

import {
  persistSaleReturn,
} from "./sale-return-persistence.service.js";

export const saleReturnCreateService = {
  async createReturn(
    input: CreateSaleReturnInput,
  ) {
    return saleReturnRepository.transaction(
      async (tx) => {
        const sale =
          await saleReturnRepository
            .lockSaleForReturn(
              tx,
              input.saleId,
              input.empresaId,
            );

        if (!sale) {
          throw new SaleReturnNotFoundError();
        }

        await validateSaleReturnContext(
          tx,
          sale,
          input.usuarioId,
        );

        const {
          preparedItems,
          totals,
        } =
          await prepareReturnItems(
            tx,
            sale,
            input.detalles,
          );

        const {
          preparedRefunds,
        } =
          await prepareReturnRefunds(
            tx,
            sale,
            input.usuarioId,
            input.sesionCajaId,
            input.reembolsos,
            totals.total,
          );

        return persistSaleReturn({
          tx,
          sale,
          input,
          items:
            preparedItems,

          refunds:
            preparedRefunds,

          totals,
        });
      },
    );
  },
};