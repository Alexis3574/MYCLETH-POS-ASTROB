import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAuthSession } from '../auth/useAuthSession'
import { useRemoteResource } from '../../hooks/useRemoteResource'
import { useMethods, usePermission } from '../commercial/commercial.hooks'
import type { PaymentMethod } from '../commercial/commercial.types'
import Pagination from '../commercial/Pagination'
import QueryFeedback from '../commercial/QueryFeedback'
import CashSessionPicker from '../cash/CashSessionPicker'
import type { CashChoice } from '../cash/CashSessionPicker'
import { formatSaleAmount, formatSaleDate } from '../sales/sales.query'
import { purchaseService } from './purchase.service'
import { decimal, normalizeAction, scaled } from './purchase.logic'
import type { PurchaseAction } from './purchase.types'
const money = (value: string) => formatSaleAmount(Number(value))
export default function PurchaseDetail({ id, onConfirm, error, backTo }: { id: string; onConfirm: (action: PurchaseAction) => void; error: string; backTo: string }) {
  const auth = useAuthSession()!, canCreate = usePermission('COMPRAS.CREAR'), canCancel = usePermission('COMPRAS.CANCELAR')
  const load = useCallback((token: string, signal: AbortSignal) => purchaseService.detail(token, id, signal), [id])
  const resource = useRemoteResource('purchase:' + id, true, load), purchase = resource.data
  const [mode, setMode] = useState<'pay' | 'cancel' | null>(null), [proposal, setProposal] = useState<PurchaseAction | null>(null)
  const [methodPage, setMethodPage] = useState(1), [method, setMethod] = useState<PaymentMethod | null>(null), [cash, setCash] = useState<CashChoice | null>(null)
  const [paymentAmount, setPaymentAmount] = useState(''), [reference, setReference] = useState(''), [reason, setReason] = useState(''), [validation, setValidation] = useState('')
  const methods = useMethods(methodPage, mode === 'pay' && canCreate)
  const back = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => { if (proposal) back.current?.focus() }, [proposal])
  function reviewPayment() {
    try {
      if (!purchase || purchase.estado !== 'RECIBIDA' || !method?.activo) throw new Error('Selecciona un método activo para una compra recibida.')
      const value = decimal(paymentAmount, 2, true)
      if (scaled(value, 2) > scaled(purchase.resumen_financiero.saldo_pendiente, 2)) throw new Error('El pago supera el saldo pendiente.')
      if (method.es_efectivo && (!cash || !cash.register.activo || cash.register.sucursal_id !== purchase.sucursal_id || cash.session.caja_id !== cash.register.id || cash.session.estado !== 'ABIERTA' || cash.session.fecha_cierre !== null || cash.session.usuario_apertura_id !== auth.user.id)) throw new Error('El efectivo requiere una sesión propia abierta de la sucursal de compra.')
      setProposal(normalizeAction({ kind: 'pay', purchaseId: purchase.id, body: { metodo_pago_id: method.id, monto: value, referencia: reference || null, sesion_caja_id: method.es_efectivo ? cash!.session.id : null } })); setValidation('')
    } catch (cause) { setValidation(cause instanceof Error ? cause.message : 'Revisa el pago.') }
  }
  if (proposal && purchase) return <section className="commercial-panel purchase-confirm" aria-label="Confirmación de operación de compra"><h2>{proposal.kind === 'receive' ? 'Confirmar recepción completa' : proposal.kind === 'pay' ? 'Confirmar pago de compra' : 'Confirmar cancelación de compra'}</h2>
    <p>Compra <strong>{purchase.folio}</strong> · {purchase.proveedor.razon_social}</p>
    {proposal.kind === 'receive' ? <><p>Se reciben todos los artículos en {purchase.almacen.nombre}. Se actualizan existencias y costo promedio de los productos inventariables, auditoría y eventos de sincronización.</p><ul>{purchase.compra_detalle.map(line => <li key={line.id}>{line.producto.nombre}: {line.cantidad}</li>)}</ul></>
      : proposal.kind === 'pay' ? <><p>Método: {method?.nombre} · Importe: <strong>{money(proposal.body.monto)}</strong></p><p>Referencia: {proposal.body.referencia ?? 'Sin referencia'}</p><p>{method?.es_efectivo ? 'El pago registra una salida de efectivo de la sesión seleccionada.' : 'Se registra el pago en POSMYCLETH. Esta pantalla no envía transferencias bancarias externas.'}</p></>
        : proposal.kind === 'cancel' && <><p>Motivo: {proposal.body.motivo}</p><p>{purchase.estado === 'RECIBIDA' ? 'La cancelación revierte el inventario recibido cuando hay existencias suficientes y genera auditoría y eventos de sincronización.' : 'Se conserva el documento cancelado y su auditoría.'}</p></>}
    {(validation || error) && <p role="alert" className="sales-error">{validation || error}</p>}<div className="commercial-actions"><button ref={back} type="button" className="sales-button sales-button--secondary" onClick={() => setProposal(null)}>Volver sin registrar</button><button type="button" className="sales-button" onClick={() => onConfirm(proposal)}>{proposal.kind === 'receive' ? 'Confirmar recepción' : proposal.kind === 'pay' ? 'Confirmar pago' : 'Confirmar cancelación de compra'}</button></div>
  </section>
  return <>
    <div className="commercial-actions"><Link to={backTo} className="sales-button sales-button--secondary">Volver a compras</Link><button type="button" className="sales-button sales-button--secondary" onClick={() => { setMode(null); resource.refresh() }}>Actualizar compra</button></div><QueryFeedback resource={resource} />
    {purchase && <><section className="commercial-panel"><div className="purchase-document-heading"><h2>{purchase.folio}</h2><span className="sales-badge">{purchase.estado === 'BORRADOR' ? 'Borrador' : purchase.estado === 'RECIBIDA' ? 'Recibida' : 'Cancelada'}</span></div>
      <p>{purchase.proveedor.razon_social} · {purchase.sucursal.nombre} / {purchase.almacen.nombre}</p><p>{formatSaleDate(purchase.fecha)} UTC · Factura: {purchase.factura_proveedor ?? 'Sin factura'}</p>
      <dl className="purchase-totals"><dt>Subtotal</dt><dd>{money(purchase.subtotal)}</dd><dt>Descuento</dt><dd>{money(purchase.descuento)}</dd><dt>Impuesto</dt><dd>{money(purchase.impuesto)}</dd><dt>Total</dt><dd>{money(purchase.total)}</dd><dt>Pagado</dt><dd>{money(purchase.resumen_financiero.total_pagado)}</dd><dt>Saldo pendiente</dt><dd>{money(purchase.resumen_financiero.saldo_pendiente)}</dd></dl>
      {purchase.observaciones && <p className="purchase-notes">{purchase.observaciones}</p>}
      {!mode && <div className="commercial-actions">{canCreate && purchase.estado === 'BORRADOR' && <button type="button" className="sales-button" onClick={() => setProposal({ kind: 'receive', purchaseId: id, body: {} })}>Recibir mercancía</button>}
        {canCreate && purchase.estado === 'RECIBIDA' && scaled(purchase.resumen_financiero.saldo_pendiente, 2) > 0n && <button type="button" className="sales-button" onClick={() => { setMode('pay'); setValidation('') }}>Registrar pago de compra</button>}
        {canCancel && purchase.estado !== 'CANCELADA' && !purchase.compra_pago.length && <button type="button" className="sales-button sales-button--secondary" onClick={() => { setMode('cancel'); setValidation('') }}>Cancelar compra</button>}</div>}
      {!!purchase.compra_pago.length && <p className="sales-muted">Una compra con pagos registrados no puede cancelarse con el flujo actual.</p>}
      {purchase.estado === 'CANCELADA' && <p className="sales-muted">Compra cancelada. Los importes y el saldo se conservan como historial del documento; no se admiten pagos.</p>}
    </section>
    {mode && <section className="commercial-panel purchase-action"><h2>{mode === 'pay' ? 'Preparar pago de compra' : 'Preparar cancelación'}</h2>
      {mode === 'pay' ? <><QueryFeedback resource={methods} /><label>Método de pago de compra<select value={method?.id ?? ''} onChange={event => { setMethod(methods.data?.items.find(row => row.id === event.target.value) ?? null); setCash(null) }}><option value="">Selecciona un método</option>{method && !methods.data?.items.some(row => row.id === method.id) && <option value={method.id}>{method.nombre}</option>}{methods.data?.items.map(row => <option key={row.id} value={row.id} disabled={!row.activo}>{row.nombre}</option>)}</select></label>
        {methods.data && methods.data.total > methods.data.size && <Pagination {...methods.data} onChange={setMethodPage} />}
        <label>Importe del pago de compra<input inputMode="decimal" value={paymentAmount} onChange={event => { setPaymentAmount(event.target.value); setValidation('') }} /></label><button type="button" className="sales-button sales-button--secondary" onClick={() => setPaymentAmount(purchase.resumen_financiero.saldo_pendiente)}>Completar saldo pendiente</button>
        <label>Referencia del pago de compra (opcional)<input maxLength={150} value={reference} onChange={event => setReference(event.target.value)} /></label>
        {method?.es_efectivo && <CashSessionPicker key={method.id} branchId={purchase.sucursal_id} onSelect={setCash} />}
      </> : <label>Motivo de cancelación de compra<textarea maxLength={250} value={reason} onChange={event => { setReason(event.target.value); setValidation('') }} /></label>}
      {(validation || error) && <p role="alert" className="sales-error">{validation || error}</p>}<div className="commercial-actions"><button type="button" className="sales-button sales-button--secondary" onClick={() => setMode(null)}>Volver sin registrar</button><button type="button" className="sales-button" onClick={() => {
        if (mode === 'pay') reviewPayment()
        else try { setProposal(normalizeAction({ kind: 'cancel', purchaseId: id, body: { motivo: reason } })); setValidation('') } catch (cause) { setValidation(cause instanceof Error ? cause.message : 'Indica el motivo.') }
      }}>Revisar {mode === 'pay' ? 'pago de compra' : 'cancelación de compra'}</button></div>
    </section>}
    <section className="commercial-panel"><h2>Artículos recibidos o por recibir</h2><div className="sales-table-scroll"><table className="sales-table"><thead><tr><th>Artículo</th><th>Cantidad</th><th>Costo unitario</th><th>Descuento / impuesto</th><th className="sales-number">Total</th></tr></thead><tbody>{purchase.compra_detalle.map(row => <tr key={row.id}><td>{row.producto.nombre}<small>{row.producto.sku}{row.descripcion ? ' · ' + row.descripcion : ''}</small></td><td>{row.cantidad}</td><td>{row.precio_unitario}</td><td>{row.descuento_porcentaje}% / {row.tasa_impuesto}%</td><td className="sales-number">{money(row.total_linea)}</td></tr>)}</tbody></table></div></section>
    <section className="commercial-panel"><h2>Pagos registrados</h2>{purchase.compra_pago.length ? <div className="sales-table-scroll"><table className="sales-table"><thead><tr><th>Método y fecha UTC</th><th>Referencia</th><th className="sales-number">Importe</th></tr></thead><tbody>{purchase.compra_pago.map(row => <tr key={row.id}><td>{row.metodo_pago.nombre}<small>{formatSaleDate(row.fecha)} UTC</small></td><td className="purchase-reference">{row.referencia ?? 'Sin referencia'}</td><td className="sales-number">{money(row.monto)}</td></tr>)}</tbody></table></div> : <p>No hay pagos registrados.</p>}</section>
    </>}
  </>
}
