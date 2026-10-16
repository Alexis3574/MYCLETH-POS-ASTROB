export class TransferError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly field?: string) {
    super(message);
    this.name = "TransferError";
  }
}

export const transferNotFound = () => new TransferError(404, "TRANSFER_NOT_FOUND", "Transferencia no encontrada en la empresa.", "id");

function errorParts(error: unknown, depth = 0): string[] {
  if (depth > 5 || error === null || error === undefined) return [];
  if (typeof error === "string") return [error];
  if (typeof error !== "object") return [];
  const result: string[] = [];
  for (const field of ["code", "originalCode", "sqlState", "message", "originalMessage", "detail", "meta", "cause", "originalError", "driverAdapterError"]) {
    if (field in error) result.push(...errorParts((error as Record<string, unknown>)[field], depth + 1));
  }
  return result;
}

export function retryableTransferError(error: unknown): boolean {
  return errorParts(error).some((part) => ["P2034", "40001", "40P01"].includes(part));
}

export function translateTransferError(error: unknown): unknown {
  if (error instanceof TransferError) return error;
  const parts = errorParts(error);
  const message = parts.join(" ");
  const rules: Array<[string, number, string, string?]> = [
    ["TRANSFER_ACTOR_INACTIVE", 403, "La cuenta o empresa dejó de estar disponible."],
    ["TRANSFER_PERMISSION_REQUIRED", 403, "Se requiere el permiso INVENTARIO.TRANSFERIR."],
    ["TRANSFER_NOT_FOUND", 404, "Transferencia no encontrada en la empresa.", "id"],
    ["TRANSFER_INVALID_STATE", 409, "La transferencia debe estar en BORRADOR.", "estado"],
    ["TRANSFER_WAREHOUSE_INVALID", 400, "Los almacenes deben ser distintos, activos y pertenecer a la empresa.", "almacen_id"],
    ["TRANSFER_PRODUCT_INVALID", 400, "Los productos deben estar activos, controlar inventario y pertenecer a la empresa.", "producto_id"],
    ["TRANSFER_EMPTY", 400, "La transferencia requiere al menos un producto.", "detalles"],
    ["TRANSFER_UNIT_REQUIRES_INTEGER", 400, "La unidad del producto requiere cantidades enteras.", "cantidad"],
    ["TRANSFER_INSUFFICIENT_AVAILABLE", 409, "La cantidad supera el disponible del almacén origen.", "cantidad"],
    ["TRANSFER_STOCK_LIMIT", 400, "La entrada supera el rango NUMERIC(14,3) del destino.", "cantidad"],
    ["TRANSFER_MOVEMENTS_EXIST", 409, "La transferencia ya tiene movimientos registrados."],
    ["TRANSFER_COST_INVALID", 500, "La existencia tiene un costo inválido."],
    ["TRANSFER_TRIGGER_INVALID", 500, "El trigger de inventario no está habilitado correctamente."],
    ["TRANSFER_DETAIL_IMMUTABLE", 409, "Sólo se pueden modificar detalles de una transferencia en BORRADOR."],
  ];
  for (const [code, status, text, field] of rules) {
    if (message.includes(code)) return new TransferError(status, code, text, field);
  }
  if (parts.includes("P2002") || parts.includes("23505")) {
    return new TransferError(409, "TRANSFER_UNIQUE_CONFLICT", "El folio o la operación ya están registrados.", "folio");
  }
  if (parts.some((part) => ["P2003", "23503", "P2034", "P2028", "40P01", "40001", "55P03", "57014"].includes(part))) {
    return new TransferError(409, "TRANSFER_TRANSACTION_CONFLICT", "Conflicto de transacción; reintente con la misma clave de idempotencia.");
  }
  return error;
}
