import { useState } from 'react'
import type { SaleDetailData } from '../sales.types'
import type { ReturnInput, RefundDraft, SaleReturn } from './return.types'
import type { CashChoice } from '../../cash/CashSessionPicker'
import CashSessionPicker from '../../cash/CashSessionPicker'
import { useAuthSession } from '../../auth/useAuthSession'
import { formatSaleAmount } from '../sales.query'
import { buildReturn, distributeRefund, estimateReturn, returnBalances } from './returns.logic'

export default function ReturnForm({ sale, history, onBack, onReview, initial }: {
  sale: SaleDetailData; history: SaleReturn[]; initial?: ReturnInput; onBack: () => void; onReview: (input: ReturnInput, total: number) => void
}) {
  const session = useAuthSession()
  const [folio, setFolio] = useState(initial?.folio ?? '')
  const [reason, setReason] = useState(initial?.motivo ?? '')
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(initial?.detalles.map(item => [item.venta_detalle_id, item.cantidad]) ?? []))
  const [refunds, setRefunds] = useState<Record<string, RefundDraft>>(() => Object.fromEntries(initial?.reembolsos.map(item => [item.venta_pago_id, { amount: item.monto, reference: item.referencia ?? '' }]) ?? []))
  const [cash, setCash] = useState<CashChoice | null>(null)
  const [error, setError] = useState<string | null>(null)
  let balances: ReturnType<typeof returnBalances> | undefined
  let estimate: ReturnType<typeof estimateReturn> | undefined
  let estimationError = ''
  try { balances = returnBalances(sale, history); estimate = estimateReturn(sale, history, quantities) }
  catch (cause) { estimationError = cause instanceof Error ? cause.message : 'No se pudo comprobar el historial.' }
  const needsCash = sale.pagos.some(payment => payment.metodo_pago.es_efectivo && Number(refunds[payment.id]?.amount ?? '') > 0)
  if (!balances) return <p role="alert">{estimationError}</p>
  const rows = balances
  function review() {
    if (!session) return
    try {
      const input = buildReturn(sale, history, { folio, reason, quantities, refunds, cash, userId: session.user.id, companyId: session.user.empresa.id })
      setError(null); onReview(input, estimate!.total)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Revisa la devolución.') }
  }
  return <form className="sale-return-form" onChange={() => setError(null)} onSubmit={event => { event.preventDefault(); review() }}>
    <h3>Preparar devolución</h3>
    <p>Selecciona las cantidades que regresan. Los reembolsos se aplican a los pagos originales.</p>
    <label>Folio de devolución<input autoFocus maxLength={50} value={folio} onChange={event => setFolio(event.target.value)} /></label>
    <label>Motivo de devolución<textarea rows={2} maxLength={250} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <div className="sale-action-buttons"><button type="button" className="sales-button sales-button--secondary" onClick={() => setQuantities(Object.fromEntries(rows.items.map(row => [row.item.id, row.available ? String(row.available) : ''])))}>Seleccionar todo lo devolvible</button></div>
    {rows.items.map(({ item, available }, index) => <div className="sale-return-line" key={item.id}>
      <div><strong>{item.descripcion || item.producto.nombre}</strong><p>{item.producto.sku} · Vendido: {item.cantidad} · Aún devolvible: {available}</p></div>
      <label>Cantidad a devolver · línea {index + 1}<input inputMode="decimal" maxLength={20} disabled={available <= 0} value={quantities[item.id] ?? ''} onChange={event => setQuantities({ ...quantities, [item.id]: event.target.value })} /></label>
    </div>)}
    {estimationError && <p role="alert" className="sales-error">{estimationError}</p>}
    <p><strong>Total estimado a devolver: {estimate ? formatSaleAmount(estimate.total) : '—'}</strong></p>
    <p className="sales-muted">Hasta tres decimales en cantidades. El servidor comprueba las restricciones de cada producto y el importe definitivo; la última devolución absorbe el remanente de redondeo.</p>
    <h3>Reembolsos y reversión de pagos</h3>
    <button type="button" className="sales-button sales-button--secondary" disabled={!estimate?.total} onClick={() => { if (estimate) setRefunds(distributeRefund(estimate.total, rows.payments)) }}>Distribuir según pagos originales</button>
    {rows.payments.map(({ payment, available }, index) => <div className="sale-return-line" key={payment.id}>
      <div><strong>{payment.metodo_pago.nombre}</strong><p>Original: {formatSaleAmount(payment.monto)} · Reembolsable: {formatSaleAmount(available)}</p>
        {payment.metodo_pago.codigo === 'CREDITO' && <small>Reversión del crédito registrado; no equivale al seguimiento de cuentas por cobrar.</small>}</div>
      <label>Importe a reembolsar · pago {index + 1}<input inputMode="decimal" maxLength={16} disabled={available <= 0} value={refunds[payment.id]?.amount ?? ''} onChange={event => setRefunds({ ...refunds, [payment.id]: { reference: refunds[payment.id]?.reference ?? '', amount: event.target.value } })} /></label>
      <label>Referencia de reembolso · pago {index + 1} (opcional)<input maxLength={150} value={refunds[payment.id]?.reference ?? ''} onChange={event => setRefunds({ ...refunds, [payment.id]: { amount: refunds[payment.id]?.amount ?? '', reference: event.target.value } })} /></label>
    </div>)}
    {needsCash && <CashSessionPicker branchId={sale.sucursal.id} onSelect={setCash} />}
    <p className="sales-muted">Se registra la devolución en el sistema; esta pantalla no envía transferencias bancarias externas.</p>
    {error && <p role="alert" className="sales-error">{error}</p>}
    <div className="sale-action-buttons"><button type="button" className="sales-button sales-button--secondary" onClick={onBack}>Volver sin registrar</button>
      <button type="submit" className="sales-button">Revisar devolución</button></div>
  </form>
}
