import type { SaleDetailData } from '../sales.types.ts'
import type { CashChoice } from '../../cash/CashSessionPicker.tsx'
import type { ItemBalance, PaymentBalance, RefundDraft, ReturnInput, SaleReturn } from './return.types.ts'
import { toCents } from '../../pos/payment.balance.ts'

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const quantity = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000
export function returnBalances(sale: SaleDetailData, history: SaleReturn[]) {
  if (history.some(record => record.venta_id !== sale.id)) throw new Error('El historial no corresponde a esta venta.')
  const lines = history.flatMap(record => record.detalles)
  const refunds = history.flatMap(record => record.reembolsos)
  if (lines.some(line => !sale.detalles.some(item => item.id === line.venta_detalle_id)) ||
    refunds.some(refund => !sale.pagos.some(payment => payment.id === refund.venta_pago_id))) throw new Error('El historial contiene referencias que no se pueden comprobar.')
  const items: ItemBalance[] = sale.detalles.map(item => {
    const previous = lines.filter(line => line.venta_detalle_id === item.id)
    const returned = quantity(previous.reduce((sum, line) => sum + line.cantidad, 0))
    const returnedTotal = round(previous.reduce((sum, line) => sum + line.total_linea, 0))
    if (!Number.isFinite(item.cantidad) || item.cantidad <= 0 || returned > item.cantidad || returnedTotal > round(item.total_linea)) throw new Error('No se pudo comprobar la cantidad o importe ya devuelto.')
    return { item, returned, returnedTotal, available: quantity(item.cantidad - returned) }
  })
  const payments: PaymentBalance[] = sale.pagos.map(payment => {
    const returned = Math.round(refunds.filter(refund => refund.venta_pago_id === payment.id).reduce((sum, refund) => sum + Math.round(refund.monto * 100), 0))
    const original = Math.round(payment.monto * 100)
    if (!Number.isSafeInteger(original) || original < 0 || returned > original) throw new Error('No se pudo comprobar el importe reembolsable.')
    return { payment, available: (original - returned) / 100 }
  })
  return { items, payments }
}
export function estimateReturn(sale: SaleDetailData, history: SaleReturn[], selected: Record<string, string>) {
  const { items } = returnBalances(sale, history)
  let cents = 0
  const details: ReturnInput['detalles'] = []
  for (const { item, available, returnedTotal } of items) {
    const text = (selected[item.id] ?? '').trim()
    if (!text || /^0(?:\.0{1,3})?$/.test(text)) continue
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(text) || !Number.isFinite(Number(text))) throw new Error('Cada cantidad debe ser positiva y tener hasta tres decimales.')
    const requested = Number(text)
    if (requested <= 0 || requested > available) throw new Error('La cantidad solicitada supera la cantidad aún devolvible.')
    const total = quantity(requested) === available ? round(Math.max(0, item.total_linea - returnedTotal)) : round(item.total_linea * (requested / item.cantidad))
    if (!Number.isFinite(total) || total < 0) throw new Error('No se pudo estimar la devolución.')
    cents += Math.round(total * 100)
    details.push({ venta_detalle_id: item.id, cantidad: text })
  }
  if (Object.keys(selected).some(id => selected[id] && !items.some(row => row.item.id === id))) throw new Error('Hay un artículo ajeno al documento.')
  if (!Number.isSafeInteger(cents)) throw new Error('El importe excede el rango permitido.')
  return { total: cents / 100, details }
}
export function distributeRefund(total: number, payments: PaymentBalance[]): Record<string, RefundDraft> {
  let remaining = Math.round(total * 100)
  return Object.fromEntries(payments.map(({ payment, available }) => {
    const applied = Math.max(0, Math.min(remaining, Math.round(available * 100)))
    remaining -= applied
    return [payment.id, { amount: applied ? (applied / 100).toFixed(2) : '', reference: '' }]
  }))
}
export function buildReturn(sale: SaleDetailData, history: SaleReturn[], values: {
  folio: string; reason: string; quantities: Record<string, string>; refunds: Record<string, RefundDraft>
  cash: CashChoice | null; userId: string; companyId: string
}): ReturnInput {
  if (sale.estado !== 'COMPLETADA' || sale.empresa.id !== values.companyId) throw new Error('Esta venta no admite devoluciones con tu sesión.')
  const folio = values.folio.trim(), motivo = values.reason.trim()
  if (!folio || folio.length > 50) throw new Error('Indica un folio de devolución de hasta 50 caracteres.')
  if (motivo.length < 3 || motivo.length > 250) throw new Error('El motivo debe tener entre 3 y 250 caracteres.')
  const estimate = estimateReturn(sale, history, values.quantities)
  if (!estimate.details.length || estimate.total <= 0) throw new Error('Selecciona artículos con un importe positivo para devolver.')
  const balances = returnBalances(sale, history).payments
  const reembolsos: ReturnInput['reembolsos'] = []
  let paid = 0, needsCash = false
  for (const [id, draft] of Object.entries(values.refunds)) {
    if (!draft.amount.trim()) continue
    const balance = balances.find(item => item.payment.id === id)
    if (!balance) throw new Error('El pago no pertenece a esta venta.')
    const cents = toCents(draft.amount.trim())
    if (cents === null || cents <= 0 || cents > Math.round(balance.available * 100)) throw new Error('Revisa el importe: debe ser positivo y no superar lo reembolsable del pago original.')
    if (draft.reference.trim().length > 150) throw new Error('La referencia admite hasta 150 caracteres.')
    paid += cents; needsCash ||= balance.payment.metodo_pago.es_efectivo
    reembolsos.push({ venta_pago_id: id, monto: (cents / 100).toFixed(2), referencia: draft.reference.trim() || null })
  }
  if (!reembolsos.length || paid !== Math.round(estimate.total * 100)) throw new Error('La suma de reembolsos debe coincidir exactamente con el total estimado.')
  const cash = values.cash
  if (needsCash && (!cash || !cash.register.activo || cash.register.sucursal_id !== sale.sucursal.id || cash.session.caja_id !== cash.register.id ||
    cash.session.estado !== 'ABIERTA' || cash.session.fecha_cierre !== null || cash.session.usuario_apertura_id !== values.userId)) throw new Error('El reembolso en efectivo requiere una sesión propia abierta en esta sucursal.')
  return { folio, motivo, sesion_caja_id: needsCash ? cash!.session.id : null, detalles: estimate.details, reembolsos }
}
