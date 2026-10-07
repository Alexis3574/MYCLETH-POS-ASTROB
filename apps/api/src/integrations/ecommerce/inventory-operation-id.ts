export type InventoryOperationType =
  | "stock-out"
  | "stock-in";

interface BuildInventoryOperationIdParams {
  saleId:
    bigint | number | string;

  saleDetailId:
    bigint | number | string;

  operation:
    InventoryOperationType;
}

interface BuildSaleReturnInventoryOperationIdParams {
  returnId:
    bigint | number | string;

  returnDetailId:
    bigint | number | string;
}

export function buildInventoryOperationId({
  saleId,
  saleDetailId,
  operation,
}: BuildInventoryOperationIdParams): string {
  const normalizedSaleId =
    String(saleId);

  const normalizedSaleDetailId =
    String(saleDetailId);

  if (
    !normalizedSaleId ||
    !normalizedSaleDetailId
  ) {
    throw new Error(
      "saleId and saleDetailId are required to build an inventory operation ID",
    );
  }

  return (
    `sale:${normalizedSaleId}` +
    `:detail:${normalizedSaleDetailId}` +
    `:${operation}`
  );
}

export function buildSaleReturnInventoryOperationId({
  returnId,
  returnDetailId,
}: BuildSaleReturnInventoryOperationIdParams): string {
  const normalizedReturnId =
    String(returnId);

  const normalizedReturnDetailId =
    String(returnDetailId);

  if (
    !normalizedReturnId ||
    !normalizedReturnDetailId
  ) {
    throw new Error(
      "returnId and returnDetailId are required to build a return inventory operation ID",
    );
  }

  return (
    `sale-return:${normalizedReturnId}` +
    `:detail:${normalizedReturnDetailId}` +
    ":stock-in"
  );
}