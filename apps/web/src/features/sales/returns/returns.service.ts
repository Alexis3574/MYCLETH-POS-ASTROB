import { apiRequest } from '../../../services/api'
import type { ActionResult, ReturnInput } from './return.types'
import { id, money, object, path, parseReturns } from './returns.parse'
export const returnService = {
  async list(token: string, saleId: string, signal: AbortSignal) {
    return parseReturns(await apiRequest<unknown>(`${path(saleId)}/returns`, { token, signal }), saleId)
  },
  async create(token: string, saleId: string, input: ReturnInput): Promise<ActionResult> {
    const response = object(await apiRequest<unknown>(`${path(saleId)}/returns`, { token, method: 'POST', body: input }))
    const result = object(response.data)
    if (response.ok !== true || !id(result.id) || result.venta_id !== saleId || result.folio !== input.folio || !money(result.total)) throw new Error('No se pudo confirmar el registro. Comprueba el folio antes de repetir.')
    return result as unknown as ActionResult
  },
  async cancel(token: string, saleId: string): Promise<ActionResult> {
    const response = object(await apiRequest<unknown>(`${path(saleId)}/cancel`, { token, method: 'PATCH' }))
    const result = object(response.data)
    if (response.ok !== true || result.id !== saleId || result.estado !== 'CANCELADA' || typeof result.folio !== 'string') throw new Error('No se pudo confirmar la cancelación. Comprueba el estado antes de repetir.')
    return result as unknown as ActionResult
  },
}
