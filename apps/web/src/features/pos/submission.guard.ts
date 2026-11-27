import { isSaleId } from '../sales/sales.query.ts'
export interface PendingSale { companyId: string; branchId: string; folio: string; operationKey?: string }
const key = 'posmycleth.pos.pending.v1'
const unreadable: PendingSale = { companyId: '', branchId: '', folio: 'No disponible' }
export function readPendingSale(storage: Pick<Storage, 'getItem'>): PendingSale | null {
  try {
    const raw = storage.getItem(key)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && 'companyId' in value && typeof value.companyId === 'string' && isSaleId(value.companyId) &&
      'branchId' in value && typeof value.branchId === 'string' && isSaleId(value.branchId) && 'folio' in value && typeof value.folio === 'string' && value.folio.trim().length > 0 && value.folio.length <= 50 &&
      (!('operationKey' in value) || (typeof value.operationKey === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.operationKey)))) return value as PendingSale
  } catch { /* Un intento ilegible conserva el bloqueo para evitar otro envío. */ }
  return unreadable
}
export function savePendingSale(storage: Pick<Storage, 'setItem'>, pending: PendingSale) { storage.setItem(key, JSON.stringify(pending)) }
export function clearPendingSale(storage: Pick<Storage, 'removeItem'>) { storage.removeItem(key) }
