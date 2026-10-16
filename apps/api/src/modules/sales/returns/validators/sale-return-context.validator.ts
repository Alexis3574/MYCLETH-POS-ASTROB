import {
  saleContextRepository,
} from "../../repositories/sale-context.repository.js";

import {
  SaleReturnContextError,
  SaleReturnNotAllowedError,
} from "../errors/sale-return.errors.js";

import type {
  LockedReturnSale,
} from "../repositories/sale-return.repository.js";

import type {
  SaleTransaction,
} from "../../types/sales.types.js";

export async function validateSaleReturnContext(
  tx: SaleTransaction,
  sale: LockedReturnSale,
  usuarioId: bigint,
): Promise<void> {
  if (
    sale.estado !==
    "COMPLETADA"
  ) {
    throw new SaleReturnNotAllowedError(
      sale.estado,
    );
  }

  const user =
    await saleContextRepository.findUser(
      tx,
      sale.empresa_id,
      usuarioId,
    );

  if (!user) {
    throw new SaleReturnContextError(
      "usuario_id",
      "El usuario no está autorizado para registrar la devolución en esta empresa.",
    );
  }
}