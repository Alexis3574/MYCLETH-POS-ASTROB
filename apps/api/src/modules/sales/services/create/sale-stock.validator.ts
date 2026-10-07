import {
  InsufficientStockError,
} from "../../errors/sale.errors.js";

import {
  saleInventoryRepository,
} from "../../repositories/sale-inventory.repository.js";

import type {
  SaleTransaction,
} from "../../types/sales.types.js";

import type {
  RequiredStock,
} from "./sale-detail.preparer.js";

export async function validateSaleStock(
  tx: SaleTransaction,
  almacenId: bigint,
  requiredStock: RequiredStock[],
): Promise<void> {
  for (
    const requirement of
    requiredStock
  ) {
    const stock =
      await saleInventoryRepository
        .lockInventoryStock(
          tx,
          requirement.productoId,
          almacenId,
        );

    const available =
      stock === null
        ? 0
        : Number(
            stock.disponible ??
              (
                Number(
                  stock.cantidad,
                ) -
                Number(
                  stock.reservado,
                )
              ).toString(),
          );

    if (
      !Number.isFinite(
        available,
      )
    ) {
      throw new Error(
        `No se pudo determinar la existencia disponible del producto ${requirement.sku}.`,
      );
    }

    if (
      requirement.quantity >
      available
    ) {
      throw new InsufficientStockError(
        requirement.productoId,
        requirement.sku,
        requirement.quantity,
        available,
      );
    }
  }
}