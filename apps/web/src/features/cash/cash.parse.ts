import { isSaleId } from '../sales/sales.query.ts'
import { cashCents } from './cash.logic.ts'
import type { CashSessionRecord, CashSessionDetail, CashMovement } from './cash.types'
import type { Page } from '../commercial/commercial.types'
const fail = () => new Error('La respuesta de caja no se pudo comprobar.')
export function cashObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail()
  return value as Record<string, unknown>
}
const id = (value: unknown): value is string => typeof value === 'string' && isSaleId(value)
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
function money(value: unknown, signed = false): value is string {
  if (typeof value !== 'string') return false
  try { cashCents(value, signed); return true } catch { return false }
}
export function parseCashSession(value: unknown, cashId?: string): CashSessionRecord {
  const row = cashObject(value)
  if (!id(row.id) || !id(row.caja_id) || cashId !== undefined && row.caja_id !== cashId || !id(row.usuario_apertura_id) ||
    !(row.usuario_cierre_id === null || id(row.usuario_cierre_id)) || !date(row.fecha_apertura) || !(row.fecha_cierre === null || date(row.fecha_cierre)) ||
    !['ABIERTA', 'CERRADA'].includes(String(row.estado)) || !money(row.monto_apertura) ||
    !(row.notas === null || typeof row.notas === 'string') || !['monto_esperado', 'monto_cierre', 'diferencia'].every(field => row[field] === null || money(row[field], field !== 'monto_cierre'))) throw fail()
  if (row.estado === 'ABIERTA' && (row.fecha_cierre !== null || row.usuario_cierre_id !== null) || row.estado === 'CERRADA' && (row.fecha_cierre === null || row.usuario_cierre_id === null || row.monto_esperado === null || row.monto_cierre === null || row.diferencia === null)) throw fail()
  if (row.estado === 'CERRADA' && cashCents(row.monto_cierre as string) - cashCents(row.monto_esperado as string, true) !== cashCents(row.diferencia as string, true)) throw fail()
  return row as unknown as CashSessionRecord
}
export function parseCashDetail(value: unknown, sessionId: string, cashId?: string): CashSessionDetail {
  const session = parseCashSession(value, cashId), row = cashObject(value), cash = cashObject(row.caja)
  if (session.id !== sessionId || cash.id !== session.caja_id || !id(cash.sucursal_id) || typeof cash.codigo !== 'string' || typeof cash.activo !== 'boolean' ||
    !money(row.monto_esperado_actual, true) || !Array.isArray(row.resumen_movimientos)) throw fail()
  const kinds = new Set()
  for (const item of row.resumen_movimientos) {
    const group = cashObject(item), sum = cashObject(group._sum)
    if (!['ENTRADA', 'SALIDA'].includes(String(group.tipo)) || kinds.has(group.tipo) || !(sum.monto === null || money(sum.monto))) throw fail()
    kinds.add(group.tipo)
  }
  return row as unknown as CashSessionDetail
}
export function parseCashMovement(value: unknown, sessionId: string): CashMovement {
  const row = cashObject(value)
  if (!id(row.id) || row.sesion_caja_id !== sessionId || !id(row.usuario_id) || !['ENTRADA', 'SALIDA'].includes(String(row.tipo)) ||
    typeof row.concepto !== 'string' || !money(row.monto) || cashCents(row.monto) <= 0 || !(row.referencia === null || typeof row.referencia === 'string') || !date(row.fecha)) throw fail()
  return row as unknown as CashMovement
}
export function cashData(value: unknown) { const row = cashObject(value); if (row.ok !== true) throw fail(); return row.data }
export function parseCashPage<T extends { id: string }>(value: unknown, parse: (row: unknown) => T, page: number): Page<T> {
  const row = cashObject(cashData(value))
  if (!Array.isArray(row.items) || row.page !== page || !Number.isSafeInteger(row.pageSize) || Number(row.pageSize) < 1 || Number(row.pageSize) > 100 ||
    !Number.isSafeInteger(row.total) || Number(row.total) < 0 || row.items.length > Number(row.pageSize) || row.items.length > Number(row.total)) throw fail()
  const items = row.items.map(item => parse(item))
  if (new Set(items.map(item => item.id)).size !== items.length) throw fail()
  return { items, page, size: Number(row.pageSize), total: Number(row.total) }
}
