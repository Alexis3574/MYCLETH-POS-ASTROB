import type { SalesQuery, SalesFilterValues } from './sales.types'

export function isSaleId(value: string): boolean {
  return /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00.000Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function validateSalesFilters(filters: SalesFilterValues): string | null {
  if (filters.folio.length > 50) return 'El folio no puede superar 50 caracteres.'
  if (filters.fecha_desde && !validDate(filters.fecha_desde)) return 'La fecha inicial no es válida.'
  if (filters.fecha_hasta && !validDate(filters.fecha_hasta)) return 'La fecha final no es válida.'
  if (filters.fecha_desde && filters.fecha_hasta && filters.fecha_desde > filters.fecha_hasta) {
    return 'La fecha inicial no puede ser posterior a la fecha final.'
  }
  if (!['', 'COMPLETADA', 'CANCELADA'].includes(filters.estado)) return 'Selecciona un estado válido.'
  if (!['', 'CONTADO', 'CREDITO'].includes(filters.condicion_pago)) return 'Selecciona una condición de pago válida.'
  return null
}
export function readSalesQuery(params: URLSearchParams): { query: SalesQuery; error: string | null } {
  const query: SalesQuery = {
    page: Number(params.get('page') ?? '1'),
    limit: Number(params.get('limit') ?? '20'),
    folio: (params.get('folio') ?? '').trim(),
    fecha_desde: params.get('fecha_desde') ?? '',
    fecha_hasta: params.get('fecha_hasta') ?? '',
    estado: params.get('estado') ?? '',
    condicion_pago: params.get('condicion_pago') ?? '',
  }
  const paginationError = !Number.isSafeInteger(query.page) || query.page < 1 ||
    !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100
    ? 'La paginación solicitada no es válida. Aplica los filtros para restablecerla.'
    : null
  return { query, error: paginationError ?? validateSalesFilters(query) }
}
export function salesSearch(query: SalesQuery): string {
  const params = new URLSearchParams()
  if (query.page !== 1) params.set('page', String(query.page))
  if (query.limit !== 20) params.set('limit', String(query.limit))
  for (const key of ['folio', 'fecha_desde', 'fecha_hasta', 'estado', 'condicion_pago'] as const) {
    if (query[key]) params.set(key, query[key])
  }
  const search = params.toString()
  return search ? '?' + search : ''
}
export function saleLabel(value: string): string {
  const labels: Record<string, string> = {
    COMPLETADA: 'Completada', CANCELADA: 'Cancelada', CONTADO: 'Contado', CREDITO: 'Crédito',
    VIGENTE: 'Vigente', DEVUELTA_PARCIAL: 'Devolución parcial', DEVUELTA_TOTAL: 'Devolución total',
  }
  return labels[value] ?? value
}
export function formatSaleAmount(value: number): string {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
    : '—'
}
export function formatSaleDate(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date)
    : '—'
}
