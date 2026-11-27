import { useEffect, useRef, useState } from 'react'
import { ApiHttpError } from '../../services/api'
import { clearAuthSession, getAuthSession } from '../auth/auth.session'
import { useAuthSession } from '../auth/useAuthSession'
import { cashService } from './cash.service'
import { allCashRows, latestCashSessionId } from './cash.history'
import { cashCents, clearCashAttempt, matchesCashAttempt, readCashAttempt, saveCashAttempt } from './cash.logic'
import type { CashAction, CashAttempt } from './cash.types'

export function useCashMutation(onChanged: (message: string, sessionId?: string) => void) {
  const auth = useAuthSession()
  const [pending, setPending] = useState(() => readCashAttempt(window.sessionStorage))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lock = useRef(pending !== null)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const own = !!auth && !!pending && pending !== 'unreadable' && pending.companyId === auth.user.empresa.id && pending.userId === auth.user.id
  function release(message: string, sessionId?: string) {
    clearCashAttempt(window.sessionStorage)
    setPending(null); lock.current = false; setError(''); onChanged(message, sessionId)
  }
  async function run(proposal: CashAction) {
    if (!active.current || lock.current || !auth || getAuthSession()?.accessToken !== auth.accessToken) return
    const existing = readCashAttempt(window.sessionStorage)
    if (existing !== null) { lock.current = true; setPending(existing); return }
    const permission = proposal.kind === 'open' ? 'CAJAS.ABRIR' : proposal.kind === 'move' ? 'CAJAS.MOVER' : 'CAJAS.CERRAR'
    if (!auth.user.permisos.some(item => item.codigo === permission)) { setError('No tienes permiso para esta operación.'); return }
    lock.current = true; setBusy(true); setError('')
    let sent = false, protectedAttempt = false
    try {
      const signal = new AbortController().signal
      let action = proposal
      if (proposal.kind === 'open') {
        const current = await cashService.current(auth.accessToken, proposal.cashId, signal)
        if (current) throw new Error('Esta caja ya tiene una sesión abierta. Actualiza la consulta.')
        const history = await allCashRows(page => cashService.history(auth.accessToken, proposal.cashId, page, signal))
        action = { ...proposal, previousMaxId: latestCashSessionId(history) }
      } else {
        const current = await cashService.detail(auth.accessToken, proposal.sessionId, signal, proposal.cashId)
        if (current.estado !== 'ABIERTA' || !current.caja.activo || current.usuario_apertura_id !== auth.user.id) throw new Error('La operación requiere una sesión propia, abierta y activa. Actualiza la consulta.')
        if (proposal.kind === 'move' && proposal.body.tipo === 'SALIDA' && cashCents(proposal.body.monto) > cashCents(current.monto_esperado_actual, true)) throw new Error('El retiro supera el efectivo esperado. Actualiza los importes antes de continuar.')
      }
      if (!active.current || getAuthSession()?.accessToken !== auth.accessToken) return
      const stored = readCashAttempt(window.sessionStorage)
      if (stored !== null) { setPending(stored); protectedAttempt = true; return }
      const attempt: CashAttempt = { companyId: auth.user.empresa.id, userId: auth.user.id, action }
      try { saveCashAttempt(window.sessionStorage, attempt) }
      catch { throw new Error('No se pudo proteger el intento. Habilita el almacenamiento de sesión antes de registrar.') }
      setPending(attempt); protectedAttempt = true; sent = true
      const result = await cashService.run(auth.accessToken, action)
      if (!active.current || getAuthSession()?.accessToken !== auth.accessToken) return
      if (!matchesCashAttempt(attempt, result)) throw new Error('La respuesta no coincide con la operación enviada. Comprueba el resultado antes de continuar.')
      release(action.kind === 'open' ? 'Apertura registrada.' : action.kind === 'move' ? 'Movimiento registrado.' : 'Cierre registrado.', 'sesion_caja_id' in result ? result.sesion_caja_id : result.id)
    } catch (cause) {
      if (!active.current || getAuthSession()?.accessToken !== auth.accessToken) return
      const definite = cause instanceof ApiHttpError && cause.status < 500 && ![408, 409].includes(cause.status)
      if (sent && definite) {
        try { clearCashAttempt(window.sessionStorage); setPending(null); protectedAttempt = false } catch { /* Preservar bloqueo. */ }
      }
      if (cause instanceof ApiHttpError && cause.status === 401) clearAuthSession()
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar la operación.')
    } finally {
      if (!protectedAttempt) lock.current = false
      setBusy(false)
    }
  }
  async function verify() {
    if (!auth || !pending || pending === 'unreadable' || !own || busy) return
    setBusy(true); setError('')
    try {
      const signal = new AbortController().signal, action = pending.action
      const records = action.kind === 'move'
        ? await allCashRows(page => cashService.movements(auth.accessToken, action.sessionId, page, signal))
        : action.kind === 'open'
          ? await allCashRows(page => cashService.history(auth.accessToken, action.cashId, page, signal))
          : [await cashService.detail(auth.accessToken, action.sessionId, signal, action.cashId)]
      const matches = records.filter(row => matchesCashAttempt(pending, row))
      if (matches.length !== 1) throw new Error('No se encontró una única operación coincidente. Revisa el historial; no repitas una solicitud que pueda seguir en curso.')
      if (!active.current || getAuthSession()?.accessToken !== auth.accessToken) return
      const result = matches[0]
      release('Operación confirmada al consultar el historial.', 'sesion_caja_id' in result ? result.sesion_caja_id : result.id)
    } catch (cause) {
      if (!active.current || getAuthSession()?.accessToken !== auth.accessToken) return
      if (cause instanceof ApiHttpError && cause.status === 401) clearAuthSession()
      setError(cause instanceof Error ? cause.message : 'No se pudo comprobar el resultado.')
    } finally { setBusy(false) }
  }
  return { pending, own, busy, error, run, verify, release }
}
