import { apiRequest } from '../../services/api'
import { object, parsePage, responseData, validId } from '../suppliers/supplier.parse'
import { parsePurchase } from './purchase.parse'
import { matchesPurchaseResult, normalizeAction } from './purchase.logic'
import type { PurchaseAttempt } from './purchase.types'
const path = (id: string): `/purchases/${string}` => { if (!validId(id)) throw new Error('Compra no válida.'); return `/purchases/${id}` }
export const purchaseService = {
  async list(token: string, state: string, supplierId: string, page: number, signal: AbortSignal) {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' })
    if (state) params.set('estado', state)
    if (supplierId) { if (!validId(supplierId)) throw new Error('Proveedor no válido.'); params.set('proveedor_id', supplierId) }
    return parsePage(await apiRequest(`/purchases?${params}`, { token, signal }), row => parsePurchase(row), page)
  },
  async detail(token: string, id: string, signal: AbortSignal) { return parsePurchase(responseData(await apiRequest(path(id), { token, signal })), id) },
  async run(token: string, attempt: PurchaseAttempt) {
    const action = normalizeAction(attempt.action)
    const endpoint: `/${string}` = action.kind === 'create' ? '/purchases' : action.kind === 'receive' ? `${path(action.purchaseId)}/receive` : action.kind === 'pay' ? `${path(action.purchaseId)}/payments` : `${path(action.purchaseId)}/cancel`
    const result = object(responseData(await apiRequest(endpoint, { token, method: 'POST', body: action.body, idempotencyKey: attempt.key })))
    if (typeof result.replayed !== 'boolean') throw new Error('No se pudo comprobar la confirmación de la operación.')
    const purchase = parsePurchase(result.data, action.kind === 'create' ? undefined : action.purchaseId)
    if (!matchesPurchaseResult(action, purchase, attempt.companyId, attempt.userId)) throw new Error('El resultado no coincide con la operación solicitada.')
    return { purchase, replayed: result.replayed }
  },
}
