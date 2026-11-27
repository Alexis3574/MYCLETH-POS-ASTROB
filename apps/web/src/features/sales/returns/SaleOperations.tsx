import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useRemoteResource } from '../../../hooks/useRemoteResource'
import { usePermission } from '../../commercial/commercial.hooks'
import QueryFeedback from '../../commercial/QueryFeedback'
import type { SaleDetailData } from '../sales.types'
import { formatSaleAmount, formatSaleDate } from '../sales.query'
import { returnService } from './returns.service'
import { useSaleMutation } from './useSaleMutation'
import ReturnForm from './ReturnForm'
import type { ReturnInput } from './return.types'
import '../../../pages/CommercialPage.css'
import './returns.css'

export default function SaleOperations({ sale, onBusy, onChanged }: {
  sale: SaleDetailData; onBusy: (busy: boolean) => void; onChanged: (message: string) => void
}) {
  const canReturn = usePermission('VENTAS.DEVOLVER'), canCancel = usePermission('VENTAS.CANCELAR')
  const load = useCallback((token: string, signal: AbortSignal) => returnService.list(token, sale.id, signal), [sale.id])
  const resource = useRemoteResource('returns:' + sale.id, true, load)
  const mutation = useSaleMutation(sale, onBusy, onChanged)
  const [mode, setMode] = useState<'history' | 'return' | 'confirm-return' | 'confirm-cancel'>('history')
  const [proposal, setProposal] = useState<{ input: ReturnInput; total: number } | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [releaseError, setReleaseError] = useState('')
  const backButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => { if (mode.startsWith('confirm')) backButton.current?.focus() }, [mode])
  const history = resource.data?.devoluciones ?? []
  const knownIds = history.map(record => record.id)
  if (mutation.pending) return <section className="sale-detail-section sale-operations" aria-label="Revisión de operación pendiente">
    <h3>{mutation.busy ? 'Procesando operación…' : 'Comprueba el intento anterior'}</h3>
    <p role={mutation.busy ? 'status' : 'alert'}>{mutation.error ?? 'La captura permanece bloqueada hasta comprobar el resultado. No se reenvía automáticamente.'}</p>
    {mutation.own && <p>{mutation.pending.action === 'return' ? 'Devolución: ' + mutation.pending.folio : 'Cancelación de venta pendiente de verificar.'}</p>}
    {mutation.own && mutation.pending.saleId !== sale.id && <Link to={'/sales/' + mutation.pending.saleId}>Ver venta del intento anterior</Link>}
    <div className="sale-action-buttons"><button type="button" className="sales-button" disabled={mutation.busy || !mutation.own} onClick={() => void mutation.verify()}>Comprobar resultado</button></div>
    <p>Una consulta sin resultado no demuestra que una solicitud haya terminado. Si no puedes comprobarla, solicita la revisión a una persona autorizada.</p>
    <label className="sale-action-check"><input type="checkbox" checked={reviewed} disabled={mutation.busy} onChange={event => setReviewed(event.target.checked)} />He comprobado el resultado y puedo continuar sin duplicar la operación.</label>
    {releaseError && <p role="alert">{releaseError}</p>}
    <button type="button" className="sales-button sales-button--secondary" disabled={!reviewed || mutation.busy} onClick={() => {
      try { mutation.release('Protección liberada después de la revisión manual.'); setReviewed(false) }
      catch { setReleaseError('No se pudo retirar la protección de este navegador.') }
    }}>Habilitar operaciones después de revisar</button>
  </section>
  if (mode === 'confirm-cancel' || mode === 'confirm-return') return <section className="sale-detail-section sale-operations" aria-label="Confirmación de operación">
    <h3>{mode === 'confirm-cancel' ? 'Confirmar cancelación total' : 'Confirmar devolución'}</h3>
    <p>Venta: <strong>{sale.folio}</strong></p>
    {mode === 'confirm-return' && proposal ? <><p>Devolución: <strong>{proposal.input.folio}</strong></p>
      <p>{proposal.input.detalles.length} {proposal.input.detalles.length === 1 ? 'línea' : 'líneas'} · Total estimado: <strong>{formatSaleAmount(proposal.total)}</strong></p>
      <p>Motivo: {proposal.input.motivo}</p></> : <p>Importe original: <strong>{formatSaleAmount(sale.total)}</strong></p>}
    <p>Esta operación afecta el documento, inventario, pagos y auditoría. Se conservan los registros originales.</p>
    {mode === 'confirm-cancel' && <p>No se admite cancelar una venta con devoluciones. El efectivo requiere que su sesión original continúe abierta.</p>}
    <div className="sale-action-buttons"><button ref={backButton} type="button" className="sales-button sales-button--secondary" onClick={() => setMode(mode === 'confirm-return' ? 'return' : 'history')}>Volver sin registrar</button>
      <button type="button" className="sales-button" onClick={() => void mutation.run(mode === 'confirm-return' ? 'return' : 'cancel', mode === 'confirm-return' ? proposal!.input : null, knownIds)}>{mode === 'confirm-cancel' ? 'Confirmar cancelación' : 'Confirmar devolución'}</button></div>
    {mutation.error && <p role="alert" className="sales-error">{mutation.error}</p>}
  </section>
  if (mode === 'return' && resource.data) return <section className="sale-detail-section sale-operations commercial-page"><ReturnForm sale={sale} history={history} initial={proposal?.input}
    onBack={() => setMode('history')} onReview={(input, total) => { setProposal({ input, total }); setMode('confirm-return') }} /></section>
  return <section className="sale-detail-section sale-operations" aria-label="Historial y operaciones de venta">
    <h3>Devoluciones y cancelación</h3><QueryFeedback resource={resource} />
    {mutation.error && <p role="alert" className="sales-error">{mutation.error}</p>}
    {resource.data && <>
      <div className="sale-action-buttons">
        {canReturn && <button type="button" className="sales-button" disabled={sale.estado !== 'COMPLETADA' || resource.data.total_devuelto >= sale.total} onClick={() => setMode('return')}>Preparar devolución</button>}
        {canCancel && <button type="button" className="sales-button sales-button--secondary" disabled={sale.estado !== 'COMPLETADA' || history.length > 0 || sale.devoluciones.tiene_devoluciones} onClick={() => setMode('confirm-cancel')}>Cancelar venta completa</button>}
        <button type="button" className="sales-button sales-button--secondary" onClick={resource.refresh}>Actualizar devoluciones</button>
      </div>
      {(!canReturn && !canCancel) && <p>Tu usuario puede consultar este historial; no tiene permisos para registrar devoluciones o cancelaciones.</p>}
      {sale.estado === 'CANCELADA' && <p>Esta venta está cancelada y no admite otra operación.</p>}
      {history.length > 0 && <p>Una venta con devoluciones no puede cancelarse después. Los importes originales se conservan en el documento.</p>}
      {!history.length && <p role="status">Esta venta no tiene devoluciones registradas.</p>}
      {history.map(record => <article className="sale-return-record" key={record.id}><h4>{record.folio} · {formatSaleAmount(record.total)}</h4>
        <p>{formatSaleDate(record.fecha)} UTC · {record.motivo}</p>
        <ul>{record.detalles.map(line => <li key={line.id}>{line.producto.nombre} · Cantidad {line.cantidad} · {formatSaleAmount(line.total_linea)}</li>)}</ul>
        <h5>Reembolsos registrados</h5><ul>{record.reembolsos.map(refund => <li key={refund.id}>{refund.metodo_pago.nombre}: {formatSaleAmount(refund.monto)}{refund.referencia ? ' · ' + refund.referencia : ''}</li>)}</ul>
      </article>)}
    </>}
  </section>
}
