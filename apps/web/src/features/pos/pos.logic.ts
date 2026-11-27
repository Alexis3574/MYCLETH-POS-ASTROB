import { isSaleId } from '../sales/sales.query.ts'
import type { CartLine, Customer, DraftPayment, PaymentMethod, Product, SaleInput, Warehouse } from '../commercial/commercial.types.ts'
import type { CashChoice } from '../cash/CashSessionPicker.tsx'

// Misma secuencia de redondeo que sales/services/create/sale-detail.preparer.ts y sale-totals.ts.
// Solo estimación: la solicitud no envía precios, tasas ni totales.
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
export const formatAmount = (value: number) => value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function decimal(value: string, scale: number, max: number, positive = false) {
  return new RegExp('^(?:0|[1-9]\\d*)(?:\\.\\d{1,' + scale + '})?$').test(value) &&
    Number.isFinite(Number(value)) && Number(value) >= (positive ? Number.MIN_VALUE : 0) && Number(value) <= max
}
export function lineError(line: CartLine): string | null {
  if (!line.product.activo || !line.product.unidad_medida.activo) return 'El producto o su unidad están inactivos.'
  if (!decimal(line.quantity, 3, 99999999999.999, true)) return 'La cantidad debe ser positiva y tener hasta 3 decimales dentro del rango permitido.'
  if ((line.product.controla_inventario || !line.product.unidad_medida.permite_decimales) && !Number.isInteger(Number(line.quantity))) return 'Este producto requiere una cantidad entera.'
  if (!decimal(line.discount, 4, 100)) return 'El descuento debe estar entre 0 y 100, con hasta 4 decimales.'
  return null
}
export function addProduct(lines: CartLine[], product: Product): CartLine[] {
  const existing = lines.find((line) => line.product.id === product.id)
  if (!existing) return [...lines, { product, quantity: '1', discount: '0' }]
  const next = { ...existing, product, quantity: String(Number(existing.quantity) + 1) }
  const error = lineError(next)
  if (error) throw new Error(error)
  return lines.map((line) => line.product.id === product.id ? next : line)
}
export function estimateSale(lines: CartLine[]) {
  if (lines.some(lineError)) return null
  const details = lines.map((line) => {
    const subtotal = round(Number(line.quantity) * Number(line.product.precio_venta))
    const descuento = round(subtotal * (Number(line.discount) / 100))
    const base = round(subtotal - descuento)
    const tax = line.product.impuestos.filter((item) => item.activo).reduce((sum, item) => sum + Number(item.tasa), 0)
    const impuesto = round(base * (tax / 100))
    return { subtotal, descuento, impuesto, total: round(base + impuesto) }
  })
  const sum = (key: keyof typeof details[number]) => round(details.reduce((value, item) => value + item[key], 0))
  const result = { subtotal: sum('subtotal'), descuento: sum('descuento'), impuesto: sum('impuesto'), total: sum('total') }
  return Object.values(result).every((value) => Number.isFinite(value) && value >= 0 && value <= 999999999999.99) ? result : null
}
export interface Draft {
  companyId: string; userId: string; warehouse: Warehouse | null; customer: Customer | null
  cash: CashChoice | null; folio: string; operationKey?: string; notes: string; lines: CartLine[]; payments: DraftPayment[]; methods: PaymentMethod[]
}
export function buildSaleInput(draft: Draft): SaleInput {
  const { warehouse, customer, cash, lines, payments, methods } = draft
  if (!warehouse || !warehouse.activo || !warehouse.sucursal.activo || warehouse.sucursal.empresa_id !== draft.companyId ||
    !isSaleId(warehouse.id) || !isSaleId(warehouse.sucursal.id) || !isSaleId(draft.companyId)) throw new Error('Selecciona un almacén activo de tu empresa.')
  const folio = draft.folio.trim()
  if ((!folio && !draft.operationKey) || folio.length > 50) throw new Error('Indica un folio de hasta 50 caracteres.')
  if (!lines.length) throw new Error('Agrega al menos un producto.')
  for (const line of lines) {
    if (!isSaleId(line.product.id) || line.product.empresa_id !== draft.companyId) throw new Error('Hay un producto ajeno a tu empresa.')
    const error = lineError(line)
    if (error) throw new Error(line.product.nombre + ': ' + error)
  }
  if (new Set(lines.map((line) => line.product.id)).size !== lines.length) throw new Error('Hay productos duplicados en el carrito.')
  if (customer && (!customer.activo || !isSaleId(customer.id))) throw new Error('El cliente seleccionado no está disponible.')
  const estimate = estimateSale(lines)
  if (!estimate || estimate.total <= 0) throw new Error('Revisa cantidades, descuentos e importes. El total debe ser positivo.')
  if (!payments.length) throw new Error('Agrega al menos un pago.')
  const chosen = payments.map((payment) => {
    const method = methods.find((item) => item.id === payment.methodId && item.activo)
    if (!method) throw new Error('Selecciona un método de pago activo en cada pago.')
    if (!decimal(payment.amount, 2, 999999999999.99, true)) throw new Error('Cada pago debe ser positivo y tener hasta 2 decimales.')
    if (payment.reference.trim().length > 150) throw new Error('La referencia no puede superar 150 caracteres.')
    return method
  })
  if (chosen.some((item) => item.codigo === 'CREDITO') && !customer) throw new Error('Una venta a crédito requiere cliente.')
  const needsCash = chosen.some((item) => item.es_efectivo)
  if (needsCash && (!cash || !cash.register.activo || cash.register.sucursal_id !== warehouse.sucursal.id ||
    cash.session.caja_id !== cash.register.id || cash.session.estado !== 'ABIERTA' || cash.session.fecha_cierre !== null ||
    cash.session.usuario_apertura_id !== draft.userId || !isSaleId(cash.session.id))) throw new Error('El efectivo requiere una sesión abierta por tu usuario en esta sucursal.')
  const paidCents = payments.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0)
  if (paidCents !== Math.round(estimate.total * 100)) throw new Error('La suma de pagos debe coincidir con el total estimado. Captura importes exactos, sin cambio.')
  return {
    empresa_id: draft.companyId, sucursal_id: warehouse.sucursal.id, almacen_id: warehouse.id,
    cliente_id: customer?.id ?? null, sesion_caja_id: needsCash ? cash!.session.id : null,
    ...(folio ? { folio } : {}), ...(draft.operationKey ? { clave_idempotencia: draft.operationKey } : {}), observaciones: draft.notes.trim() || null,
    detalles: lines.map((line) => ({ producto_id: line.product.id, cantidad: line.quantity, descuento_porcentaje: line.discount })),
    pagos: payments.map((item) => ({ metodo_pago_id: item.methodId, monto: item.amount, referencia: item.reference.trim() || null })),
  }
}
