export type InventoryOperationType =
  | "stock-out"
  | "stock-in";

interface BuildInventoryOperationIdParams {
  saleId: bigint | number | string;
  saleDetailId: bigint | number | string;
  operation: InventoryOperationType;
}

export function buildInventoryOperationId({
  saleId,
  saleDetailId,
  operation,
}: BuildInventoryOperationIdParams): string {
  const normalizedSaleId = String(saleId);
  const normalizedSaleDetailId = String(saleDetailId);

  if (!normalizedSaleId || !normalizedSaleDetailId) {
    throw new Error(
      "saleId and saleDetailId are required to build an inventory operation ID",
    );
  }

  return `sale:${normalizedSaleId}:detail:${normalizedSaleDetailId}:${operation}`;
}