import type { SaleReturn } from './return.types.ts'
import { isSaleId } from '../sales.query.ts'
export interface PendingAction {
  companyId: string; userId: string; saleId: string; action: 'return' | 'cancel'; folio: string; expected?: string; knownReturnIds: string[]
}
const key = 'posmycleth.sales.action.pending.v1'
const unreadable: PendingAction = { companyId: '', userId: '', saleId: '', action: 'cancel', folio: '', knownReturnIds: [] }
export function readAction(storage: Pick<Storage, 'getItem'>): PendingAction | null {
  try {
    const raw = storage.getItem(key)
    if (raw === null) return null
    const item: unknown = JSON.parse(raw)
    if (item && typeof item === 'object' && 'companyId' in item && typeof item.companyId === 'string' && isSaleId(item.companyId) &&
      'userId' in item && typeof item.userId === 'string' && isSaleId(item.userId) && 'saleId' in item && typeof item.saleId === 'string' && isSaleId(item.saleId) &&
      'action' in item && (item.action === 'cancel' || item.action === 'return') && 'folio' in item && typeof item.folio === 'string' && item.folio.length <= 50 &&
      (item.action === 'cancel' || item.folio.trim().length > 0) && 'knownReturnIds' in item && Array.isArray(item.knownReturnIds) &&
      item.knownReturnIds.every(value => typeof value === 'string' && isSaleId(value)) && (!('expected' in item) || (typeof item.expected === 'string' && item.expected.length < 100000))) return item as PendingAction
  } catch { /* Un registro ilegible mantiene la protección. */ }
  return unreadable
}
export function saveAction(storage: Pick<Storage, 'setItem'>, value: PendingAction) { storage.setItem(key, JSON.stringify(value)) }
export function clearAction(storage: Pick<Storage, 'removeItem'>) { storage.removeItem(key) }

export function returnFingerprint(details: { venta_detalle_id: string; cantidad: string | number }[], refunds: { venta_pago_id: string; monto: string | number }[]) {
  const order = (a: (string | number)[], b: (string | number)[]) => String(a[0]).localeCompare(String(b[0]))
  return JSON.stringify({ details: details.map(row => [row.venta_detalle_id, Number(row.cantidad)]).sort(order), refunds: refunds.map(row => [row.venta_pago_id, Number(row.monto)]).sort(order) })
}
export function matchesPendingReturn(pending: PendingAction, record: SaleReturn) {
  return pending.action === 'return' && record.venta_id === pending.saleId && record.usuario_id === pending.userId && record.folio === pending.folio &&
    !pending.knownReturnIds.includes(record.id) && !!pending.expected && pending.expected === returnFingerprint(record.detalles, record.reembolsos)
}
