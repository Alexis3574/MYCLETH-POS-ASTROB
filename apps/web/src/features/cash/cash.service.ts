import { apiRequest } from '../../services/api'
import { isSaleId } from '../sales/sales.query'
import { cashData, parseCashSession, parseCashDetail, parseCashMovement, parseCashPage } from './cash.parse'
import type { CashAction } from './cash.types'
function id(value: string) { if (!isSaleId(value)) throw new Error('Identificador de caja no válido.'); return value }
const path = (cashId: string): `/cash/${string}` => `/cash/${id(cashId)}`
const sessionPath = (sessionId: string): `/cash/sessions/${string}` => `/cash/sessions/${id(sessionId)}`
export const cashService = {
  async current(token: string, cashId: string, signal: AbortSignal) {
    const value = cashData(await apiRequest(`${path(cashId)}/sessions/current`, { token, signal }))
    if (value === null) return null
    const session = parseCashSession(value, cashId)
    if (session.estado !== 'ABIERTA') throw new Error('La sesión actual recibida no está abierta.')
    return session
  },
  async history(token: string, cashId: string, page: number, signal: AbortSignal) {
    return parseCashPage(await apiRequest(`${path(cashId)}/sessions?page=${page}&pageSize=20`, { token, signal }), row => parseCashSession(row, cashId), page)
  },
  async detail(token: string, sessionId: string, signal: AbortSignal, cashId?: string) {
    return parseCashDetail(cashData(await apiRequest(sessionPath(sessionId), { token, signal })), sessionId, cashId)
  },
  async movements(token: string, sessionId: string, page: number, signal: AbortSignal) {
    return parseCashPage(await apiRequest(`${sessionPath(sessionId)}/movements?page=${page}&pageSize=20`, { token, signal }), row => parseCashMovement(row, sessionId), page)
  },
  async run(token: string, action: CashAction) {
    const endpoint: `/${string}` = action.kind === 'open' ? `${path(action.cashId)}/sessions` : `${sessionPath(action.sessionId)}/${action.kind === 'move' ? 'movements' : 'close'}`
    const value = cashData(await apiRequest(endpoint, { token, method: 'POST', body: action.body }))
    return action.kind === 'move' ? parseCashMovement(value, action.sessionId) : parseCashSession(value, action.cashId)
  },
}
