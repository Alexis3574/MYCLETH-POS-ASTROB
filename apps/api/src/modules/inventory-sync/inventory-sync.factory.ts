import type { Prisma } from "../../generated/prisma/client.js";
import { buildInventoryOperationId } from "../../integrations/ecommerce/inventory-operation-id.js";
import { inventorySyncRepository } from "./inventory-sync.repository.js";

interface CreateSaleInventorySyncParams {
  tx: Prisma.TransactionClient;
  movimientoInventarioId: bigint;
  saleId: bigint;
  saleDetailId: bigint;
  codigoBarras: string | null;
  sku: string;
  quantity: number;
}

function validateQuantity(
  quantity: number,
) {
  if (
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    throw new Error(
      "La sincronización de inventario con el e-commerce requiere una cantidad entera positiva.",
    );
  }
}

export async function createSaleStockOutSync({
  tx,
  movimientoInventarioId,
  saleId,
  saleDetailId,
  codigoBarras,
  sku,
  quantity,
}: CreateSaleInventorySyncParams) {
  validateQuantity(quantity);

  const operationId =
    buildInventoryOperationId({
      saleId,
      saleDetailId,
      operation: "stock-out",
    });

  return inventorySyncRepository.createPending(
    {
      movimientoInventarioId,
      operationId,
      codigoBarras,
      sku,
      adjustment: -quantity,
    },
    tx,
  );
}

export async function createSaleStockInSync({
  tx,
  movimientoInventarioId,
  saleId,
  saleDetailId,
  codigoBarras,
  sku,
  quantity,
}: CreateSaleInventorySyncParams) {
  validateQuantity(quantity);

  const operationId =
    buildInventoryOperationId({
      saleId,
      saleDetailId,
      operation: "stock-in",
    });

  return inventorySyncRepository.createPending(
    {
      movimientoInventarioId,
      operationId,
      codigoBarras,
      sku,
      adjustment: quantity,
    },
    tx,
  );
}