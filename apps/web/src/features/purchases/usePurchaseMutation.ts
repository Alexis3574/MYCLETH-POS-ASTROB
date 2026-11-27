import { useEffect, useRef, useState } from 'react'
import { ApiHttpError } from '../../services/api'
import { clearAuthSession, getAuthSession } from '../auth/auth.session'
import { useAuthSession } from '../auth/useAuthSession'
import { clearPurchaseAttempt, normalizeAction, readPurchaseAttempt, savePurchaseAttempt } from './purchase.logic'
import { purchaseService } from './purchase.service'
import type { PurchaseAction, PurchaseAttempt, PurchaseRecord } from './purchase.types'

export function usePurchaseMutation(onChanged: (purchase: PurchaseRecord, kind: PurchaseAction['kind']) => void) {
  const auth = useAuthSession()
  const [pending, setPending] = useState(() => readPurchaseAttempt(window.sessionStorage))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lock = useRef(pending !== null), active = useRef(true), sending = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const own = !!auth && !!pending && pending !== 'unreadable' && pending.companyId === auth.user.empresa.id && pending.userId === auth.user.id
  async function send(attempt: PurchaseAttempt) {
    if (!auth || !active.current || sending.current || getAuthSession()?.accessToken !== auth.accessToken) return
    const permission = attempt.action.kind === 'cancel' ? 'COMPRAS.CANCELAR' : 'COMPRAS.CREAR'
    if (!auth.user.permisos.some(item => item.codigo === permission)) { setError('No tienes permiso para esta operación.'); return }
    sending.current = true; setBusy(true); setError('')
    try {
      const result = await purchaseService.run(auth.accessToken, attempt)
      if (!active.current || getAuthSession()?.accessToken !== auth.accessToken) return
      clearPurchaseAttempt(window.sessionStorage); setPending(null); lock.current = false
      onChanged(result.purchase, attempt.action.kind)
    } catch (cause) {
      if (!active.current || getAuthSession()?.accessToken !== auth.accessToken) return
      if (cause instanceof ApiHttpError && cause.status < 500 && ![408,409].includes(cause.status)) {
        try { clearPurchaseAttempt(window.sessionStorage); setPending(null); lock.current = false } catch { /* Conservar protección. */ }
      }
      if (cause instanceof ApiHttpError && cause.status === 401) clearAuthSession()
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar el resultado de la compra.')
    } finally { sending.current = false; setBusy(false) }
  }
  function run(action: PurchaseAction) {
    if (lock.current || !auth || getAuthSession()?.accessToken !== auth.accessToken) return
    const stored = readPurchaseAttempt(window.sessionStorage)
    if (stored) { setPending(stored); lock.current = true; return }
    try {
      const attempt: PurchaseAttempt = { companyId: auth.user.empresa.id, userId: auth.user.id, key: crypto.randomUUID(), action: normalizeAction(action) }
      savePurchaseAttempt(window.sessionStorage, attempt)
      lock.current = true; setPending(attempt); void send(attempt)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo proteger el intento antes de enviar.') }
  }
  function retry() {
    if (busy || !pending || pending === 'unreadable' || !own) return
    // La clave y el cuerpo se reutilizan literalmente; nunca se genera otro intento.
    void send(pending)
  }
  function release() { clearPurchaseAttempt(window.sessionStorage); setPending(null); lock.current = false; setError('') }
  return { pending, own, busy, error, run, retry, release }
}
