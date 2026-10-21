export class PurchaseError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'PurchaseError';
  }
}

export const purchaseError = {
  notFound: () => new PurchaseError(404, 'PURCHASE_NOT_FOUND', 'La compra no existe dentro de la empresa.'),
  conflict: (code: string, message: string) => new PurchaseError(409, code, message),
  invalid: (message: string) => new PurchaseError(422, 'PURCHASE_INVALID_CONTEXT', message),
  forbidden: () => new PurchaseError(403, 'PURCHASE_ACTOR_INVALID', 'Usuario sin acceso válido a esta empresa.'),
};

function parts(error: unknown, depth = 0): string[] {
  if (depth > 5 || error === null || error === undefined) return [];
  if (typeof error === 'string') return [error];
  if (typeof error !== 'object') return [];
  const result: string[] = [];
  for (const key of ['code', 'originalCode', 'sqlState', 'message', 'originalMessage', 'detail', 'meta', 'cause', 'driverAdapterError']) {
    if (key in error) result.push(...parts((error as Record<string, unknown>)[key], depth + 1));
  }
  return result;
}

export function purchaseRetryable(error: unknown): boolean {
  return parts(error).some((item) => ['P2034', '40001', '40P01'].includes(item));
}

export function translatePurchaseError(error: unknown): unknown {
  if (error instanceof PurchaseError) return error;
  const message = parts(error).join(' ');
  if (message.includes('23505') || message.includes('P2002')) {
    return purchaseError.conflict('PURCHASE_DUPLICATE', 'Folio, referencia u operación ya registrada.');
  }
  if (message.includes('Existencia insuficiente')) {
    return purchaseError.conflict('PURCHASE_INSUFFICIENT_STOCK', 'No existe inventario disponible suficiente para revertir la recepción.');
  }
  if (['40P01', '40001', '55P03', 'P2034', 'P2028'].some((code) => message.includes(code))) {
    return purchaseError.conflict('PURCHASE_TRANSACTION_CONFLICT', 'Conflicto de transacción. Repita la solicitud con la misma clave de idempotencia.');
  }
  if (message.includes('23514') || message.includes('P2003') || message.includes('23503')) {
    return purchaseError.invalid('La operación incumple una restricción de integridad de la base de datos.');
  }
  return error;
}
