import type { Prisma } from "../../generated/prisma/client.js";
import { buildInventoryOperationId } from "../../integrations/ecommerce/inventory-operation-id.js";
import { inventorySyncRepository } from "./inventory-sync.repository.js";

interface CreateSaleStockOutSyncParams {
  tx: Prisma.TransactionClient;
  movimientoInventarioId: bigint;
  saleId: bigint;
  saleDetailId: bigint;
  codigoBarras: string | null;
  sku: string;
  quantity: number;
}

export async function createSaleStockOutSync({
  tx,
  movimientoInventarioId,
  saleId,
  saleDetailId,
  codigoBarras,
  sku,
  quantity,
}: CreateSaleStockOutSyncParams) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(
      "E-commerce inventory synchronization requires a positive integer quantity",
    );
  }

  const operationId = buildInventoryOperationId({
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