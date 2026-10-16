import type {
  Prisma,
} from "../../generated/prisma/client.js";

import {
  buildSaleReturnInventoryOperationId,
} from "../../integrations/ecommerce/inventory-operation-id.js";

import {
  inventorySyncRepository,
} from "./inventory-sync.repository.js";

interface CreateSaleReturnStockInSyncParams {
  tx:
    Prisma.TransactionClient;

  movimientoInventarioId:
    bigint;

  returnId:
    bigint;

  returnDetailId:
    bigint;

  codigoBarras:
    string | null;

  sku:
    string;

  quantity:
    number;
}

function validateReturnQuantity(
  quantity: number,
): void {
  if (
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    throw new Error(
      "La sincronización de una devolución con el e-commerce requiere una cantidad entera positiva.",
    );
  }
}

export async function createSaleReturnStockInSync({
  tx,
  movimientoInventarioId,
  returnId,
  returnDetailId,
  codigoBarras,
  sku,
  quantity,
}: CreateSaleReturnStockInSyncParams) {
  validateReturnQuantity(
    quantity,
  );

  const operationId =
    buildSaleReturnInventoryOperationId({
      returnId,
      returnDetailId,
    });

  return inventorySyncRepository.createPending(
    {
      movimientoInventarioId,
      operationId,
      codigoBarras,
      sku,
      adjustment:
        quantity,
    },
    tx,
  );
}