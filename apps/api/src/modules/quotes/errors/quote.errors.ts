export class QuoteError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'QuoteError';
  }
}
export const quoteErrors = {
  notFound: () => new QuoteError(404, 'QUOTE_NOT_FOUND', 'Cotización no encontrada o sin acceso.'),
  invalid: (message: string) => new QuoteError(422, 'QUOTE_INVALID_CONTEXT', message),
  forbidden: () => new QuoteError(403, 'QUOTE_FORBIDDEN', 'Usuario sin acceso a la sucursal.'),
  conflict: (message: string) => new QuoteError(409, 'QUOTE_CONFLICT', message),
};
export function quoteDatabaseError(error: unknown): unknown {
  if (error instanceof QuoteError) return error;
  const codes = new Set<string>();
  const seen = new Set<unknown>();
  function gather(node: unknown, depth: number) {
    if (depth > 5 || node === null || node === undefined || seen.has(node)) return;
    if (typeof node === 'string') { if (node.length < 800) codes.add(node); return; }
    if (typeof node !== 'object') return;
    seen.add(node);
    for (const key of ['code', 'originalCode', 'sqlState', 'message', 'meta', 'cause', 'driverAdapterError']) {
      if (key in node) gather((node as Record<string, unknown>)[key], depth + 1);
    }
  }
  gather(error, 0);
  const text = [...codes].join(' ');
  if (/P2002|23505/.test(text)) return quoteErrors.conflict('Folio duplicado para la sucursal.');
  if (/P2034|40001|40P01|55P03|P2028/.test(text)) return quoteErrors.conflict('Conflicto de transacción; repita la operación tras consultar su estado.');
  if (/P2003|23503|23514|22003/.test(text)) return quoteErrors.invalid('La operación incumple una restricción de PostgreSQL.');
  return error;
}
