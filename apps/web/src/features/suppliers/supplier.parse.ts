import { isSaleId } from '../sales/sales.query.ts'
import type { Page } from '../commercial/commercial.types'
import type { Supplier, SupplierDetail } from './supplier.types'
export function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Respuesta de consulta no válida.'); return value as Record<string, unknown> }
export const validId = (value: unknown): value is string => typeof value === 'string' && isSaleId(value)
export const nullableText = (value: unknown) => value === null || typeof value === 'string'
export function responseData(value: unknown) { const row = object(value); if (row.ok !== true) throw new Error('El servidor no confirmó la operación.'); return row.data }
export function parsePage<T extends { id: string }>(value: unknown, parse: (row: unknown) => T, expectedPage: number): Page<T> {
  const body = object(responseData(value))
  if (body.page !== expectedPage || !Number.isSafeInteger(body.pageSize) || Number(body.pageSize) < 1 || Number(body.pageSize) > 100 || !Number.isSafeInteger(body.total) || Number(body.total) < 0 || !Array.isArray(body.items) || body.items.length > Number(body.pageSize) || body.items.length > Number(body.total)) throw new Error('Paginación del servidor no válida.')
  const items = body.items.map(row => parse(row))
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('El listado contiene registros duplicados.')
  return { items, total: Number(body.total), page: expectedPage, size: Number(body.pageSize) }
}
export function parseSupplier(value: unknown): Supplier {
  const row = object(value)
  if (!validId(row.id) || !validId(row.empresa_id) || typeof row.codigo !== 'string' || typeof row.razon_social !== 'string' || typeof row.activo !== 'boolean' ||
    !['nombre_comercial','rfc','email','telefono','contacto'].every(field => nullableText(row[field])) || !Number.isInteger(row.dias_credito) || Number(row.dias_credito) < 0 || Number(row.dias_credito) > 3650) throw new Error('Proveedor del servidor no válido.')
  return row as unknown as Supplier
}
export function parseSupplierDetail(value: unknown, expectedId: string): SupplierDetail {
  const supplier = parseSupplier(value), row = object(value)
  if (supplier.id !== expectedId || !Array.isArray(row.proveedor_direccion)) throw new Error('Detalle del proveedor no válido.')
  const ids = new Set<string>()
  for (const entry of row.proveedor_direccion) {
    const address = object(entry)
    if (!validId(address.id) || ids.has(address.id) || address.proveedor_id !== expectedId || !['FISCAL','ENTREGA','OTRA'].includes(String(address.tipo)) || typeof address.pais !== 'string' || typeof address.es_principal !== 'boolean' ||
      !['calle','numero_exterior','numero_interior','colonia','municipio','estado','codigo_postal'].every(field => nullableText(address[field]))) throw new Error('Domicilio del proveedor no válido.')
    ids.add(address.id)
  }
  return row as unknown as SupplierDetail
}
