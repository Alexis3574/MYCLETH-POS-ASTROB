import { useRef, useState } from 'react'
import { ApiHttpError } from '../../../services/api'
import { clearAuthSession, getAuthSession } from '../../auth/auth.session'
import { useAuthSession } from '../../auth/useAuthSession'
import { salesService } from '../sales.service'
import type { SaleDetailData } from '../sales.types'
import { clearAction, readAction, saveAction, returnFingerprint, matchesPendingReturn } from './action.guard'
import type { PendingAction } from './action.guard'
import { returnService } from './returns.service'
import type { ReturnInput } from './return.types'

function pendingAction() {
  try { return readAction(window.sessionStorage) }
  catch { return { companyId: '', userId: '', saleId: '', action: 'cancel' as const, folio: '', knownReturnIds: [] } }
}
export function useSaleMutation(sale: SaleDetailData, onBusy: (busy: boolean) => void, onChanged: (message: string) => void) {
  const session = useAuthSession()
  const [pending, setPending] = useState(pendingAction)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locked = useRef(pending !== null)
  const own = !!pending && pending.companyId === session?.user.empresa.id && pending.userId === session?.user.id
  function release(message: string) {
    clearAction(window.sessionStorage)
    setPending(null); locked.current = false; setError(null); onChanged(message)
  }
  async function run(action: 'return' | 'cancel', input: ReturnInput | null, knownReturnIds: string[]) {
    if (locked.current || !session || getAuthSession()?.accessToken !== session.accessToken) return
    const stored = pendingAction()
    if (stored) { setPending(stored); locked.current = true; return }
    const permission = action === 'return' ? 'VENTAS.DEVOLVER' : 'VENTAS.CANCELAR'
    if (!session.user.permisos.some(item => item.codigo === permission)) { setError('No tienes permiso para esta operación.'); return }
    const attempt: PendingAction = { companyId: session.user.empresa.id, userId: session.user.id, saleId: sale.id, action, folio: input?.folio ?? '', knownReturnIds, ...(input ? { expected: returnFingerprint(input.detalles, input.reembolsos) } : {}) }
    locked.current = true
    try { saveAction(window.sessionStorage, attempt) }
    catch { locked.current = false; setError('No se pudo proteger el intento. Habilita el almacenamiento de sesión antes de registrar.'); return }
    setPending(attempt); setBusy(true); onBusy(true); setError(null)
    try {
      const result = action === 'return' && input
        ? await returnService.create(session.accessToken, sale.id, input)
        : await returnService.cancel(session.accessToken, sale.id)
      if (getAuthSession()?.accessToken !== session.accessToken) return
      release(action === 'return' ? 'Devolución registrada: ' + result.folio : 'Venta cancelada: ' + result.folio)
    } catch (cause) {
      const definite = cause instanceof ApiHttpError && cause.status < 500 && ![408, 409].includes(cause.status)
      if (definite) {
        try { clearAction(window.sessionStorage); setPending(null); locked.current = false } catch { /* Conservar protección. */ }
      }
      if (cause instanceof ApiHttpError && cause.status === 401 && getAuthSession()?.accessToken === session.accessToken) clearAuthSession()
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar el resultado de la operación.')
    } finally { setBusy(false); onBusy(false) }
  }
  async function verify() {
    if (!session || !pending || !own || busy) return
    setBusy(true); onBusy(true); setError(null)
    try {
      if (pending.action === 'return') {
        const history = await returnService.list(session.accessToken, pending.saleId, new AbortController().signal)
        const found = history.devoluciones.find(item => matchesPendingReturn(pending, item))
        if (!found) throw new Error('No se encontró un nuevo registro confirmado con ese folio. No repitas una operación que pueda seguir en curso.')
        if (getAuthSession()?.accessToken !== session.accessToken) return
        release('Devolución confirmada al consultar: ' + found.folio)
      } else {
        const current = await salesService.detail(session.accessToken, pending.saleId, new AbortController().signal)
        if (current.estado !== 'CANCELADA') throw new Error('La venta todavía no aparece cancelada. Comprueba el resultado antes de repetir.')
        if (getAuthSession()?.accessToken !== session.accessToken) return
        release('Cancelación confirmada al consultar: ' + current.folio)
      }
    } catch (cause) {
      if (cause instanceof ApiHttpError && cause.status === 401 && getAuthSession()?.accessToken === session.accessToken) clearAuthSession()
      setError(cause instanceof Error ? cause.message : 'No se pudo verificar el resultado.')
    } finally { setBusy(false); onBusy(false) }
  }
  return { pending, own, busy, error, run, verify, release }
}
