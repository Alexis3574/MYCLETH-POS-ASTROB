import { useRef, useState } from 'react'
import { useMethods } from '../commercial/commercial.hooks'
import type { DraftPayment, PaymentMethod } from '../commercial/commercial.types'
import QueryFeedback from '../commercial/QueryFeedback'
import Pagination from '../commercial/Pagination'
import { cashChange, remainingPayment } from './payment.balance'

export default function PaymentEditor({ total, payments, knownMethods, onChange, onMethod }: {
  total: number; payments: DraftPayment[]; knownMethods: PaymentMethod[]
  onChange: (payments: DraftPayment[]) => void; onMethod: (method: PaymentMethod) => void
}) {
  const [page, setPage] = useState(1)
  const resource = useMethods(page, true)
  const nextKey = useRef(Math.max(0, ...payments.map(item => item.key)) + 1)
  const [selected, setSelected] = useState(() => new Map(knownMethods.map(item => [item.id, item])))
  const [received, setReceived] = useState<Record<number, string>>({})
  const options = [...new Map([...selected.values(), ...(resource.data?.items ?? [])].map(item => [item.id, item])).values()]
  function update(key: number, values: Partial<DraftPayment>) {
    onChange(payments.map(item => item.key === key ? { ...item, ...values } : item))
    setReceived(current => ({ ...current, [key]: '' }))
  }
  return <section className="commercial-panel"><h2>Forma de cobro</h2><QueryFeedback resource={resource} />
    <p className="sales-muted">Selecciona un método y usa «Completar importe pendiente». El crédito requiere cliente.</p>
    {payments.map(payment => {
      const method = options.find(item => item.id === payment.methodId)
      const remaining = remainingPayment(total, payments, payment.key)
      const change = cashChange(received[payment.key] ?? '', payment.amount)
      return <div className="pos-payment" key={payment.key}>
        <label>Método de pago {payment.key}<select value={payment.methodId} onChange={event => {
          const method = options.find(item => item.id === event.target.value)
          update(payment.key, { methodId: event.target.value })
          if (method) { setSelected(new Map(selected).set(method.id, method)); onMethod(method) }
        }}><option value="">Selecciona un método</option>{options.map(item => <option key={item.id} value={item.id} disabled={!item.activo}>{item.nombre}</option>)}</select></label>
        <label>Importe del pago {payment.key}<input inputMode="decimal" maxLength={16} value={payment.amount} onChange={event => update(payment.key, { amount: event.target.value })} /></label>
        <button type="button" className="sales-button sales-button--secondary" disabled={!remaining} onClick={() => { if (remaining) update(payment.key, { amount: remaining }) }}>Completar importe pendiente<span className="sales-sr-only"> del pago {payment.key}</span></button>
        {method?.es_efectivo && <div>
          <label>Efectivo recibido para pago {payment.key} (opcional)<input inputMode="decimal" maxLength={16} value={received[payment.key] ?? ''} onChange={event => setReceived({ ...received, [payment.key]: event.target.value })} /></label>
          {received[payment.key] && <p role="status">{change === null ? 'Revisa el efectivo recibido: debe cubrir el importe aplicado y tener hasta dos decimales.' : 'Cambio a entregar: ' + change}</p>}
          <small>Ayuda de cálculo. Solo el importe aplicado se registra como pago.</small>
        </div>}
        <label>Referencia del pago {payment.key} (opcional)<input maxLength={150} value={payment.reference} onChange={event => update(payment.key, { reference: event.target.value })} /></label>
        <button type="button" className="sales-button sales-button--secondary" onClick={() => onChange(payments.filter(item => item.key !== payment.key))}>Quitar pago {payment.key}</button>
      </div>
    })}
    <button type="button" className="sales-button sales-button--secondary" onClick={() => onChange([...payments, { key: nextKey.current++, methodId: '', amount: remainingPayment(total, payments) ?? '', reference: '' }])}>Agregar pago</button>
    {resource.data && resource.data.total > resource.data.size && <Pagination {...resource.data} onChange={setPage} />}
    <p className="sales-muted">Pagos aplicados y crédito deben cubrir exactamente el total estimado. La API confirma el importe definitivo.</p>
  </section>
}
