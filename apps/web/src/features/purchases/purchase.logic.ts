import { isSaleId } from '../sales/sales.query.ts'
import type { CreatePurchase, PurchaseAction, PurchaseAttempt, PurchaseDraftLine, PurchaseRecord } from './purchase.types'
const maximum = 99999999999999n
export function decimal(value: string, scale: number, positive = false) {
  const text = value.trim(), match = /^(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match) throw new Error('Captura un número decimal sin separadores ni exponentes.')
  const whole = match[1].replace(/^0+(?=\d)/, ''), fraction = match[2] ?? ''
  if (whole.length > 14 - scale || fraction.length > scale) throw new Error(`El importe o cantidad admite hasta ${scale} decimales y ${14 - scale} enteros.`)
  const result = whole + '.' + fraction.padEnd(scale, '0')
  if (positive && scaled(result, scale) === 0n) throw new Error('La cantidad o importe debe ser mayor a cero.')
  return result
}
export function scaled(value: string, scale: number): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Decimal no válido.')
  const [whole, part = ''] = value.split('.')
  if (part.length > scale) throw new Error('Precisión no válida.')
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(part.padEnd(scale, '0'))
}
export function amount(value: bigint) { return value / 100n + '.' + String(value % 100n).padStart(2, '0') }
const round = (value: bigint, divisor: bigint) => (value + divisor / 2n) / divisor
function text(value: string, max: number, required = false) {
  const normalized = value.trim()
  if (normalized.length > max || required && !normalized) throw new Error(`Revisa el campo obligatorio o su límite de ${max} caracteres.`)
  return normalized
}
function identifier(value: string) { if (!isSaleId(value)) throw new Error('Selecciona un registro válido.'); return value }
export function normalizeCreate(body: CreatePurchase): CreatePurchase {
  const seen = new Set<string>()
  if (!Array.isArray(body.detalles) || !body.detalles.length || body.detalles.length > 100) throw new Error('La compra debe contener entre 1 y 100 productos distintos.')
  return { sucursal_id: identifier(body.sucursal_id), almacen_id: identifier(body.almacen_id), proveedor_id: identifier(body.proveedor_id), folio: text(body.folio, 50, true), factura_proveedor: text(body.factura_proveedor ?? '', 80) || null, observaciones: text(body.observaciones ?? '', 2000) || null,
    detalles: body.detalles.map(line => {
      identifier(line.producto_id)
      if (seen.has(line.producto_id)) throw new Error('No se permiten productos repetidos en la compra.')
      seen.add(line.producto_id)
      const discount = decimal(line.descuento_porcentaje, 4), tax = decimal(line.tasa_impuesto, 4)
      if (scaled(discount, 4) > 1000000n || scaled(tax, 4) > 1000000n) throw new Error('Descuento e impuesto deben estar entre 0 y 100 %.')
      return { producto_id: line.producto_id, descripcion: text(line.descripcion ?? '', 250) || null, cantidad: decimal(line.cantidad, 3, true), precio_unitario: decimal(line.precio_unitario, 4), descuento_porcentaje: discount, tasa_impuesto: tax }
    }) }
}
export function buildPurchase(context: Omit<CreatePurchase, 'detalles'>, lines: PurchaseDraftLine[], companyId: string) {
  for (const line of lines) {
    const product = line.product, quantity = scaled(decimal(line.quantity, 3, true), 3)
    if (product.empresa_id !== companyId || !product.activo || !product.unidad_medida.activo) throw new Error('Hay un producto inactivo o ajeno a la empresa.')
    if ((!product.unidad_medida.permite_decimales || product.controla_inventario) && quantity % 1000n !== 0n) throw new Error('Este producto requiere cantidades enteras.')
    if (product.controla_inventario && (product.tipo !== 'PRODUCTO' || !product.codigo_barras || quantity > 2147483647000n)) throw new Error('El producto inventariable requiere código de barras y cantidad entera compatible con la recepción.')
  }
  return normalizeCreate({ ...context, detalles: lines.map(line => ({ producto_id: line.product.id, descripcion: line.description || null, cantidad: line.quantity, precio_unitario: line.price, descuento_porcentaje: line.discount, tasa_impuesto: line.tax })) })
}
export function estimatePurchase(lines: CreatePurchase['detalles']) {
  let subtotal = 0n, discount = 0n, tax = 0n
  for (const row of lines) {
    const base = round(scaled(row.cantidad, 3) * scaled(row.precio_unitario, 4), 100000n)
    const reduction = round(base * scaled(row.descuento_porcentaje, 4), 1000000n)
    subtotal += base; discount += reduction; tax += round((base - reduction) * scaled(row.tasa_impuesto, 4), 1000000n)
  }
  const total = subtotal - discount + tax
  if ([subtotal, discount, tax, total].some(value => value < 0n || value > maximum)) throw new Error('Los importes exceden el límite del documento.')
  return { subtotal: amount(subtotal), descuento: amount(discount), impuesto: amount(tax), total: amount(total) }
}
export function normalizeAction(action: PurchaseAction): PurchaseAction {
  if (action.kind === 'create') { const body = normalizeCreate(action.body); estimatePurchase(body.detalles); return { kind: 'create', body } }
  identifier(action.purchaseId)
  if (action.kind === 'receive') return { kind: 'receive', purchaseId: action.purchaseId, body: {} }
  if (action.kind === 'cancel') return { kind: 'cancel', purchaseId: action.purchaseId, body: { motivo: text(action.body.motivo, 250, true) } }
  if (action.kind !== 'pay') throw new Error('Acción no válida.')
  return { kind: 'pay', purchaseId: action.purchaseId, body: { metodo_pago_id: identifier(action.body.metodo_pago_id), sesion_caja_id: action.body.sesion_caja_id === null ? null : identifier(action.body.sesion_caja_id), monto: decimal(action.body.monto, 2, true), referencia: text(action.body.referencia ?? '', 150) || null } }
}
export function matchesPurchaseResult(action: PurchaseAction, row: PurchaseRecord, companyId: string, userId: string) {
  if (row.empresa_id !== companyId || action.kind !== 'create' && row.id !== action.purchaseId) return false
  if (action.kind === 'receive') return row.estado === 'RECIBIDA'
  if (action.kind === 'cancel') return row.estado === 'CANCELADA'
  if (action.kind === 'pay') return row.estado === 'RECIBIDA' && row.compra_pago.some(payment => payment.metodo_pago_id === action.body.metodo_pago_id && payment.sesion_caja_id === action.body.sesion_caja_id && scaled(payment.monto,2) === scaled(action.body.monto,2) && payment.referencia === action.body.referencia)
  if (row.usuario_id !== userId || row.estado !== 'BORRADOR') return false
  const actual = normalizeCreate({ sucursal_id: row.sucursal_id, almacen_id: row.almacen_id, proveedor_id: row.proveedor_id, folio: row.folio, factura_proveedor: row.factura_proveedor, observaciones: row.observaciones, detalles: row.compra_detalle.map(line => ({ producto_id: line.producto_id, descripcion: line.descripcion, cantidad: line.cantidad, precio_unitario: line.precio_unitario, descuento_porcentaje: line.descuento_porcentaje, tasa_impuesto: line.tasa_impuesto })) })
  const requested = normalizeCreate(action.body)
  const sorted = (body: CreatePurchase) => ({ ...body, detalles: [...body.detalles].sort((a,b) => a.producto_id.localeCompare(b.producto_id)) })
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted(requested))
}
const key = 'posmycleth.purchase.pending.v1'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function readPurchaseAttempt(storage: Pick<Storage, 'getItem'>): PurchaseAttempt | 'unreadable' | null {
  try {
    const raw = storage.getItem(key)
    if (raw === null) return null
    const row = JSON.parse(raw) as PurchaseAttempt
    if (row && typeof row.companyId === 'string' && typeof row.userId === 'string' && isSaleId(row.companyId) && isSaleId(row.userId) && typeof row.key === 'string' && uuid.test(row.key) && JSON.stringify(normalizeAction(row.action)) === JSON.stringify(row.action)) return row
  } catch { /* Una protección dañada bloquea nuevos envíos. */ }
  return 'unreadable'
}
export function savePurchaseAttempt(storage: Pick<Storage, 'setItem'>, value: PurchaseAttempt) { storage.setItem(key, JSON.stringify(value)) }
export function clearPurchaseAttempt(storage: Pick<Storage, 'removeItem'>) { storage.removeItem(key) }
