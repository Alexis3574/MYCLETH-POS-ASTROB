import { isSaleId } from '../sales.query.ts'
import type { ReturnsData, SaleReturn } from './return.types'
export const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Respuesta de devoluciones no válida.')
  return value as Record<string, unknown>
}
export const id = (value: unknown): value is string => typeof value === 'string' && isSaleId(value)
export const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
function returnRecord(value: unknown, saleId: string): SaleReturn {
  const row = object(value)
  if (!id(row.id) || !id(row.usuario_id) || row.venta_id !== saleId || typeof row.folio !== 'string' || !row.folio || typeof row.motivo !== 'string' ||
    typeof row.fecha !== 'string' || !Number.isFinite(Date.parse(row.fecha)) || !money(row.total) || !Array.isArray(row.detalles) || !Array.isArray(row.reembolsos)) throw new Error('La devolución recibida no se pudo interpretar.')
  for (const entry of row.detalles) {
    const line = object(entry), product = object(line.producto)
    if (!id(line.id) || !id(line.venta_detalle_id) || !id(product.id) || typeof product.nombre !== 'string' || typeof product.sku !== 'string' ||
      typeof line.cantidad !== 'number' || !Number.isFinite(line.cantidad) || line.cantidad <= 0 ||
      !['subtotal_linea', 'descuento_importe', 'impuesto_importe', 'total_linea'].every(key => money(line[key]))) throw new Error('El detalle de devolución no es válido.')
  }
  for (const entry of row.reembolsos) {
    const refund = object(entry), method = object(refund.metodo_pago)
    if (!id(refund.id) || !id(refund.venta_pago_id) || !money(refund.monto) || !(refund.referencia === null || typeof refund.referencia === 'string') ||
      !id(method.id) || typeof method.codigo !== 'string' || typeof method.nombre !== 'string' || typeof method.es_efectivo !== 'boolean') throw new Error('El reembolso recibido no es válido.')
  }
  if (new Set(row.detalles.map(entry => object(entry).id)).size !== row.detalles.length || new Set(row.reembolsos.map(entry => object(entry).id)).size !== row.reembolsos.length) throw new Error('La devolución contiene líneas o reembolsos duplicados.')
  return row as unknown as SaleReturn
}
export function path(saleId: string): `/sales/${string}` {
  if (!isSaleId(saleId)) throw new Error('Venta no válida.')
  return `/sales/${saleId}`
}
export function parseReturns(value: unknown, saleId: string): ReturnsData {
  const response = object(value), data = object(response.data), sale = object(data.venta)
  if (response.ok !== true || sale.id !== saleId || typeof sale.estado !== 'string' || typeof sale.folio !== 'string' || !money(sale.total) ||
    !Array.isArray(data.devoluciones) || !Number.isSafeInteger(data.total_devoluciones) || !money(data.total_devuelto) || data.total_devoluciones !== data.devoluciones.length) throw new Error('No se pudo comprobar el historial de devoluciones.')
  const rows = data.devoluciones.map(item => returnRecord(item, saleId))
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('El historial contiene registros duplicados.')
  return { ...data, devoluciones: rows } as unknown as ReturnsData
}
