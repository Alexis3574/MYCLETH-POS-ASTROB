import { decimal, scaled, amount } from './purchase.logic.ts'
import { nullableText, object, validId } from '../suppliers/supplier.parse.ts'
import type { PurchaseRecord } from './purchase.types'
const fail = () => new Error('La compra recibida no se pudo comprobar.')
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
function money(value: unknown, scale = 2): value is string { if (typeof value !== 'string') return false; try { decimal(value, scale); return true } catch { return false } }
export function parsePurchase(value: unknown, expectedId?: string): PurchaseRecord {
  const row = object(value)
  if (!['id','empresa_id','sucursal_id','almacen_id','proveedor_id','usuario_id'].every(field => validId(row[field])) || expectedId !== undefined && row.id !== expectedId || typeof row.folio !== 'string' || !row.folio || !nullableText(row.factura_proveedor) || !nullableText(row.observaciones) || !date(row.fecha) || !['BORRADOR','RECIBIDA','CANCELADA'].includes(String(row.estado)) ||
    !['subtotal','descuento','impuesto','total'].every(field => money(row[field])) || !Array.isArray(row.compra_detalle) || !Array.isArray(row.compra_pago)) throw fail()
  const supplier = object(row.proveedor), branch = object(row.sucursal), warehouse = object(row.almacen)
  if (supplier.id !== row.proveedor_id || typeof supplier.codigo !== 'string' || typeof supplier.razon_social !== 'string' || typeof supplier.activo !== 'boolean' || branch.id !== row.sucursal_id || warehouse.id !== row.almacen_id || ![branch, warehouse].every(entry => typeof entry.nombre === 'string' && typeof entry.codigo === 'string')) throw fail()
  const detailIds = new Set(), productIds = new Set(), paymentIds = new Set()
  let subtotal = 0n, discount = 0n, tax = 0n, total = 0n, paid = 0n
  for (const entry of row.compra_detalle) {
    const line = object(entry), product = object(line.producto)
    if (!validId(line.id) || detailIds.has(line.id) || !validId(line.producto_id) || productIds.has(line.producto_id) || line.compra_id !== row.id || product.id !== line.producto_id || typeof product.nombre !== 'string' || typeof product.sku !== 'string' || !nullableText(line.descripcion) || !money(line.cantidad, 3) || scaled(line.cantidad as string, 3) === 0n || !money(line.precio_unitario, 4) || !money(line.descuento_porcentaje, 4) || !money(line.tasa_impuesto, 4) || !['subtotal_linea','descuento_importe','impuesto_importe','total_linea'].every(field => money(line[field]))) throw fail()
    detailIds.add(line.id); productIds.add(line.producto_id)
    const base = scaled(line.subtotal_linea as string, 2), reduction = scaled(line.descuento_importe as string, 2), taxes = scaled(line.impuesto_importe as string, 2), sum = scaled(line.total_linea as string, 2)
    if (base - reduction + taxes !== sum || reduction > base) throw fail()
    subtotal += base; discount += reduction; tax += taxes; total += sum
  }
  if (!detailIds.size || subtotal !== scaled(row.subtotal as string, 2) || discount !== scaled(row.descuento as string, 2) || tax !== scaled(row.impuesto as string, 2) || total !== scaled(row.total as string, 2)) throw fail()
  for (const entry of row.compra_pago) {
    const payment = object(entry), method = object(payment.metodo_pago)
    if (!validId(payment.id) || paymentIds.has(payment.id) || payment.compra_id !== row.id || !validId(payment.metodo_pago_id) || !(payment.sesion_caja_id === null || validId(payment.sesion_caja_id)) || !money(payment.monto) || scaled(payment.monto as string, 2) === 0n || !nullableText(payment.referencia) || !date(payment.fecha) || typeof method.codigo !== 'string' || typeof method.nombre !== 'string' || typeof method.es_efectivo !== 'boolean') throw fail()
    paymentIds.add(payment.id); paid += scaled(payment.monto as string, 2)
  }
  if (paid > total) throw fail()
  const summary = { total_pagado: amount(paid), saldo_pendiente: amount(total - paid) }
  if (row.resumen_financiero !== undefined) {
    const supplied = object(row.resumen_financiero)
    if (!money(supplied.total_pagado) || !money(supplied.saldo_pendiente) || scaled(supplied.total_pagado, 2) !== paid || scaled(supplied.saldo_pendiente, 2) !== total - paid) throw fail()
  }
  return { ...row, resumen_financiero: summary } as unknown as PurchaseRecord
}
