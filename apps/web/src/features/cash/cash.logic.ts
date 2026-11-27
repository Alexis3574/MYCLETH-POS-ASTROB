import type { CashAction, CashAttempt, CashMovement, CashSessionRecord } from './cash.types'
import { isSaleId } from '../sales/sales.query.ts'

export function cashCents(value: string, signed = false): number {
  if (!(signed ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/).test(value)) throw new Error('Importe de caja no válido.')
  const negative = value.startsWith('-'), [whole, part = ''] = value.replace(/^-/, '').split('.')
  const cents = BigInt(whole) * 100n + BigInt(part.padEnd(2, '0'))
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('El importe supera la precisión admitida.')
  return Number(cents) * (negative ? -1 : 1)
}
export function cashAmount(cents: number) {
  if (!Number.isSafeInteger(cents)) throw new Error('Importe de caja no válido.')
  const absolute = Math.abs(cents)
  return (cents < 0 ? '-' : '') + Math.floor(absolute / 100) + '.' + String(absolute % 100).padStart(2, '0')
}
export function cashInput(value: string, positive = false) {
  const text = value.trim()
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(text)) throw new Error('Indica un importe válido: hasta 12 enteros y dos decimales.')
  const cents = cashCents(text)
  if (positive && cents === 0) throw new Error('El movimiento debe ser mayor a cero.')
  return cashAmount(cents)
}
export function cashNotes(value: string) {
  const text = value.trim()
  if (text.length > 1500) throw new Error('Las notas admiten hasta 1500 caracteres.')
  return text || null
}
export function cashMovementInput(type: string, amount: string, concept: string, reference: string) {
  if (!['ENTRADA', 'SALIDA'].includes(type)) throw new Error('Tipo de movimiento no válido.')
  if (concept.trim().length < 3 || concept.trim().length > 180) throw new Error('Describe el concepto con entre 3 y 180 caracteres.')
  if (reference.trim().length < 3 || reference.trim().length > 105) throw new Error('La referencia debe tener entre 3 y 105 caracteres.')
  return { tipo: type as 'ENTRADA' | 'SALIDA', concepto: concept.trim(), monto: cashInput(amount, true), referencia: reference.trim() }
}
export function matchesCashAttempt(attempt: CashAttempt, row: CashSessionRecord | CashMovement) {
  const action = attempt.action
  if (action.kind === 'move') {
    if (!('sesion_caja_id' in row)) return false
    return row.sesion_caja_id === action.sessionId && row.usuario_id === attempt.userId && row.tipo === action.body.tipo &&
      row.concepto === action.body.concepto && row.referencia === 'MANUAL:' + action.body.referencia && cashCents(row.monto) === cashCents(action.body.monto)
  }
  if (!('caja_id' in row) || row.caja_id !== action.cashId) return false
  return action.kind === 'open'
    ? BigInt(row.id) > BigInt(action.previousMaxId) && row.usuario_apertura_id === attempt.userId && cashCents(row.monto_apertura) === cashCents(action.body.monto_apertura) && row.notas === action.body.notas
    : row.id === action.sessionId && row.estado === 'CERRADA' && row.usuario_cierre_id === attempt.userId && row.monto_cierre !== null &&
      cashCents(row.monto_cierre) === cashCents(action.body.monto_cierre) && (action.body.notas === null || row.notas === action.body.notas)
}

const key = 'posmycleth.cash.action.pending.v1'
export type StoredCashAttempt = CashAttempt | 'unreadable' | null
function validAction(value: unknown): value is CashAction {
  if (!value || typeof value !== 'object' || !('kind' in value) || !('cashId' in value) || typeof value.cashId !== 'string' || !isSaleId(value.cashId) || !('body' in value) || !value.body || typeof value.body !== 'object') return false
  const body = value.body as Record<string, unknown>
  try {
    if (value.kind === 'open') return 'previousMaxId' in value && typeof value.previousMaxId === 'string' && (value.previousMaxId === '0' || isSaleId(value.previousMaxId)) && typeof body.monto_apertura === 'string' && cashInput(body.monto_apertura) === body.monto_apertura && (body.notas === null || typeof body.notas === 'string' && cashNotes(body.notas) === body.notas)
    if (!('sessionId' in value) || typeof value.sessionId !== 'string' || !isSaleId(value.sessionId)) return false
    if (value.kind === 'close') return typeof body.monto_cierre === 'string' && cashInput(body.monto_cierre) === body.monto_cierre && (body.notas === null || typeof body.notas === 'string' && cashNotes(body.notas) === body.notas)
    if (value.kind === 'move' && typeof body.monto === 'string' && typeof body.concepto === 'string' && typeof body.referencia === 'string' && typeof body.tipo === 'string') {
      const parsed = cashMovementInput(body.tipo, body.monto, body.concepto, body.referencia)
      return Object.entries(parsed).every(([field, item]) => body[field] === item)
    }
  } catch { return false }
  return false
}
export function readCashAttempt(storage: Pick<Storage, 'getItem'>): StoredCashAttempt {
  try {
    const raw = storage.getItem(key)
    if (raw === null) return null
    const row: unknown = JSON.parse(raw)
    if (row && typeof row === 'object' && 'companyId' in row && typeof row.companyId === 'string' && isSaleId(row.companyId) &&
      'userId' in row && typeof row.userId === 'string' && isSaleId(row.userId) && 'action' in row && validAction(row.action)) return row as CashAttempt
  } catch { /* Mantener el bloqueo si no se puede leer. */ }
  return 'unreadable'
}
export function saveCashAttempt(storage: Pick<Storage, 'setItem'>, attempt: CashAttempt) { storage.setItem(key, JSON.stringify(attempt)) }
export function clearCashAttempt(storage: Pick<Storage, 'removeItem'>) { storage.removeItem(key) }
