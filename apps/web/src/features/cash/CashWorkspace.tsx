import { useCallback, useState } from 'react'
import { useAuthSession } from '../auth/useAuthSession'
import { usePermission, useCash } from '../commercial/commercial.hooks'
import type { CashRegister } from '../commercial/commercial.types'
import { useRemoteResource } from '../../hooks/useRemoteResource'
import QueryFeedback from '../commercial/QueryFeedback'
import Pagination from '../commercial/Pagination'
import { formatSaleAmount, formatSaleDate } from '../sales/sales.query'
import { cashCents } from './cash.logic'
import { cashService } from './cash.service'
import { useCashMutation } from './useCashMutation'
import CashActionForm from './CashActionForm'
import type { CashAction, CashSessionRecord } from './cash.types'
import './cash.css'

const money = (value: string | null) => value === null ? '—' : formatSaleAmount(cashCents(value, true) / 100)
const date = (value: string | null) => value === null ? '—' : formatSaleDate(value) + ' UTC'

export default function CashWorkspace() {
  const auth = useAuthSession()
  return auth ? <Workspace key={auth.accessToken} /> : null
}
function Workspace() {
  const auth = useAuthSession()!
  const allowed = usePermission('CAJAS.VER'), canOpen = usePermission('CAJAS.ABRIR'), canMove = usePermission('CAJAS.MOVER'), canClose = usePermission('CAJAS.CERRAR')
  const [page, setPage] = useState(1), [manual, setManual] = useState<CashRegister | null>(null)
  const [historyPage, setHistoryPage] = useState(1), [movementPage, setMovementPage] = useState(1)
  const [selectedSession, setSelectedSession] = useState(''), [revision, setRevision] = useState(0)
  const [mode, setMode] = useState<CashAction['kind'] | null>(null), [notice, setNotice] = useState('')
  const [reviewed, setReviewed] = useState(false), [releaseError, setReleaseError] = useState('')
  const registers = useCash('', page, allowed)
  const selected = manual ?? (registers.data?.total === 1 ? registers.data.items[0] : null)
  const cashId = selected?.id ?? ''
  const currentLoad = useCallback((token: string, signal: AbortSignal) => cashService.current(token, cashId, signal), [cashId])
  const current = useRemoteResource('cash-current:' + cashId + ':' + revision, allowed && !!cashId, currentLoad)
  const historyLoad = useCallback((token: string, signal: AbortSignal) => cashService.history(token, cashId, historyPage, signal), [cashId, historyPage])
  const history = useRemoteResource('cash-history:' + cashId + ':' + historyPage + ':' + revision, allowed && !!cashId, historyLoad)
  const sessionId = selectedSession || current.data?.id || ''
  const detailLoad = useCallback((token: string, signal: AbortSignal) => cashService.detail(token, sessionId, signal, cashId), [sessionId, cashId])
  const detail = useRemoteResource('cash-detail:' + cashId + ':' + sessionId + ':' + revision, allowed && !!sessionId, detailLoad)
  const movementsLoad = useCallback((token: string, signal: AbortSignal) => cashService.movements(token, sessionId, movementPage, signal), [sessionId, movementPage])
  const movements = useRemoteResource('cash-movements:' + cashId + ':' + sessionId + ':' + movementPage + ':' + revision, allowed && !!sessionId, movementsLoad)
  const mutation = useCashMutation((message, id) => {
    setNotice(message); setMode(null); setReviewed(false); setRevision(value => value + 1); setMovementPage(1); setHistoryPage(1)
    if (id && selected) setSelectedSession(id)
  })
  const ownOpen = !!detail.data && detail.data.estado === 'ABIERTA' && detail.data.fecha_cierre === null && detail.data.usuario_apertura_id === auth.user.id && detail.data.caja.activo && selected?.activo
  function chooseSession(id: string) { setSelectedSession(id); setMovementPage(1); setMode(null) }
  function refresh() { setRevision(value => value + 1); setMode(null) }
  if (!allowed) return <p role="alert">No tienes permiso para consultar cajas.</p>
  if (mutation.pending) return <section className="commercial-panel cash-pending" aria-label="Revisión de caja pendiente">
    <h2>{mutation.busy ? 'Procesando operación de caja…' : 'Comprueba la operación de caja anterior'}</h2>
    <p role={mutation.busy ? 'status' : 'alert'}>{mutation.error || 'No se enviará otra operación hasta comprobar el resultado de este intento.'}</p>
    {mutation.own && mutation.pending !== 'unreadable' && <p>Caja {mutation.pending.action.cashId} · {mutation.pending.action.kind === 'open' ? 'Apertura' : mutation.pending.action.kind === 'move' ? 'Movimiento' : 'Cierre'}{mutation.pending.action.kind !== 'open' ? ' · Sesión ' + mutation.pending.action.sessionId : ''}</p>}
    <button type="button" className="sales-button" disabled={mutation.busy || !mutation.own} onClick={() => void mutation.verify()}>Comprobar operación de caja</button>
    <p>Una consulta sin coincidencias no prueba que la solicitud haya terminado. Revisa el historial antes de repetir. No se reenvían solicitudes automáticamente.</p>
    {!mutation.own && mutation.pending !== 'unreadable' && <p>Inicia sesión con el usuario del intento para comprobarlo.</p>}
    {(mutation.own || mutation.pending === 'unreadable') && (canOpen || canMove || canClose) && <>
      <label className="commercial-check"><input type="checkbox" checked={reviewed} disabled={mutation.busy} onChange={event => setReviewed(event.target.checked)} />He revisado el resultado y puedo continuar sin duplicar la operación.</label>
      {releaseError && <p role="alert">{releaseError}</p>}
      <button type="button" className="sales-button sales-button--secondary" disabled={mutation.busy || !reviewed} onClick={() => {
        try { mutation.release('Protección liberada tras la revisión manual.'); setReviewed(false) }
        catch { setReleaseError('No se pudo retirar la protección del navegador.') }
      }}>Habilitar caja después de revisar</button>
    </>}
  </section>
  return <>
    {notice && <p role="status" className="commercial-notice">{notice}</p>}
    <fieldset className="pos-fields" disabled={mutation.busy}>
      <section className="commercial-panel"><h2>Cajas disponibles</h2><QueryFeedback resource={registers} />
        <label>Caja de trabajo<select value={cashId} disabled={!!mode} onChange={event => {
          setManual(registers.data?.items.find(row => row.id === event.target.value) ?? null)
          setSelectedSession(''); setHistoryPage(1); setMovementPage(1); setMode(null); setNotice('')
        }}><option value="">Selecciona una caja</option>
          {selected && !registers.data?.items.some(row => row.id === selected.id) && <option value={selected.id}>{selected.nombre}</option>}
          {registers.data?.items.map(row => <option key={row.id} value={row.id}>{row.nombre} ({row.codigo}){row.activo ? '' : ' · Inactiva'}</option>)}
        </select></label>
        {registers.data?.total === 0 && <p>No hay cajas asignadas a tus sucursales.</p>}
        {registers.data && registers.data.total > registers.data.size && !mode && <Pagination {...registers.data} onChange={setPage} />}
      </section>
      {selected && <>
        {mode ? <CashActionForm key={cashId + ':' + sessionId + ':' + mode} kind={mode} register={selected} session={detail.data} busy={mutation.busy} error={mutation.error} onBack={() => setMode(null)} onConfirm={action => void mutation.run(action)} /> : <>
          <section className="commercial-panel"><div className="cash-section-heading"><h2>Sesión actual</h2><button type="button" className="sales-button sales-button--secondary" onClick={refresh}>Actualizar caja</button></div>
            <QueryFeedback resource={current} />
            {!selected.activo && <p role="alert">Esta caja está inactiva. Puedes consultar su historial.</p>}
            {current.status === 'success' && (current.data ? <><p>Sesión {current.data.id} · Abierta · {date(current.data.fecha_apertura)}</p>
              <p>Fondo inicial: <strong>{money(current.data.monto_apertura)}</strong></p>
              {current.data.usuario_apertura_id !== auth.user.id && <p>Esta sesión pertenece a otro usuario. Solo puedes consultarla.</p>}
              <button type="button" className="sales-button sales-button--secondary" onClick={() => chooseSession(current.data!.id)}>Ver sesión actual</button>
            </> : <><p>No hay una sesión abierta.</p>{canOpen && selected.activo && <button type="button" className="sales-button" onClick={() => setMode('open')}>Abrir caja</button>}</>)}
          </section>
          {sessionId && <section className="commercial-panel" aria-label="Detalle de sesión de caja"><h2>Detalle de sesión {sessionId}</h2><QueryFeedback resource={detail} />
            {detail.data && <>
              <p><span className={'sales-badge' + (detail.data.estado === 'CERRADA' ? ' sales-badge--cancelled' : '')}>{detail.data.estado === 'ABIERTA' ? 'Abierta' : 'Cerrada'}</span> · Apertura por usuario {detail.data.usuario_apertura_id}</p>
              <dl className="cash-totals"><dt>Fondo inicial</dt><dd>{money(detail.data.monto_apertura)}</dd>
                <dt>Entradas de efectivo</dt><dd>{money(detail.data.resumen_movimientos.find(row => row.tipo === 'ENTRADA')?._sum.monto ?? '0')}</dd>
                <dt>Salidas de efectivo</dt><dd>{money(detail.data.resumen_movimientos.find(row => row.tipo === 'SALIDA')?._sum.monto ?? '0')}</dd>
                <dt>Efectivo esperado {detail.data.estado === 'CERRADA' ? 'al cerrar' : 'actual'}</dt><dd>{money(detail.data.estado === 'CERRADA' ? detail.data.monto_esperado : detail.data.monto_esperado_actual)}</dd>
                {detail.data.estado === 'CERRADA' && <><dt>Efectivo contado</dt><dd>{money(detail.data.monto_cierre)}</dd><dt>Diferencia de cierre</dt><dd>{money(detail.data.diferencia)}</dd><dt>Cierre</dt><dd>{date(detail.data.fecha_cierre)}</dd><dt>Usuario de cierre</dt><dd>{detail.data.usuario_cierre_id}</dd></>}
              </dl>
              {detail.data.notas && <p className="cash-notes">{detail.data.notas}</p>}
              {ownOpen && <div className="commercial-actions">{canMove && <button type="button" className="sales-button" onClick={() => setMode('move')}>Registrar entrada o salida</button>}{canClose && <button type="button" className="sales-button sales-button--secondary" onClick={() => setMode('close')}>Arqueo y cierre</button>}</div>}
              {detail.data.estado === 'ABIERTA' && !ownOpen && <p>Los movimientos y el cierre requieren una sesión propia y una caja activa.</p>}
              {!canMove && !canClose && <p>Tu usuario no tiene permisos para registrar movimientos o cerrar sesiones.</p>}
              <h3>Movimientos de la sesión</h3><QueryFeedback resource={movements} />
              {movements.data && <><div className="sales-table-scroll"><table className="sales-table"><caption className="sales-sr-only">Movimientos de la sesión {sessionId}</caption><thead><tr><th>Fecha UTC</th><th>Tipo y concepto</th><th className="sales-number">Importe</th><th>Referencia</th></tr></thead><tbody>
                {movements.data.items.map(row => <tr key={row.id}><td>{date(row.fecha)}<small>Usuario {row.usuario_id} · Movimiento {row.id}</small></td><td>{row.tipo === 'ENTRADA' ? 'Entrada' : 'Salida'}<small>{row.concepto}</small></td><td className="sales-number">{money(row.monto)}</td><td className="cash-reference">{row.referencia ?? '—'}</td></tr>)}
              </tbody></table></div>{movements.data.total === 0 && <p>No hay movimientos en esta sesión.</p>}<Pagination {...movements.data} onChange={setMovementPage} /></>}
            </>}
          </section>}
          <section className="commercial-panel"><h2>Historial de sesiones</h2><QueryFeedback resource={history} />
            {history.data && <><div className="sales-table-scroll"><table className="sales-table"><caption className="sales-sr-only">Historial de sesiones de caja</caption><thead><tr><th>Sesión y apertura UTC</th><th>Estado</th><th className="sales-number">Contado / diferencia</th><th>Consulta</th></tr></thead><tbody>
              {history.data.items.map((row: CashSessionRecord) => <tr key={row.id}><td>Sesión {row.id}<small>{date(row.fecha_apertura)} · Usuario {row.usuario_apertura_id}</small></td><td>{row.estado === 'ABIERTA' ? 'Abierta' : 'Cerrada'}</td><td className="sales-number">{money(row.monto_cierre)}<small>{money(row.diferencia)}</small></td><td><button type="button" className="sales-detail-link" onClick={() => chooseSession(row.id)}>Ver sesión {row.id}</button></td></tr>)}
            </tbody></table></div>{history.data.total === 0 && <p>Esta caja todavía no tiene sesiones.</p>}<Pagination {...history.data} onChange={setHistoryPage} /></>}
          </section>
        </>}
      </>}
    </fieldset>
  </>
}
