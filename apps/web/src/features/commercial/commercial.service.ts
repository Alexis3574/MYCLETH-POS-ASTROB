import { apiRequest } from '../../services/api'
import { isSaleId } from '../sales/sales.query'
import type { CashRegister, CashSession, CreatedSale, Customer, Page, PaymentMethod, Product, SaleInput, Stock, Warehouse } from './commercial.types'

type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Respuesta del servidor no válida.')
  return value as RecordValue
}
function validPage(value: unknown, positive = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new Error('Paginación del servidor no válida.')
  return value
}
function identifier(value: unknown): value is string { return typeof value === 'string' && isSaleId(value) }
function decimal(value: unknown): value is string { return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)) }
function text(value: unknown): value is string { return typeof value === 'string' }
function bool(value: unknown): value is boolean { return typeof value === 'boolean' }
function nullableText(value: unknown) { return value === null || text(value) }
function entity(value: unknown): RecordValue { const row = record(value); if (!identifier(row.id)) throw new Error('Identificador del servidor no válido.'); return row }
function product(value: unknown): Product {
  const row = entity(value), unit = record(row.unidad_medida)
  if (!identifier(row.empresa_id) || !text(row.nombre) || !text(row.sku) || !nullableText(row.codigo_barras) ||
    !['PRODUCTO', 'SERVICIO'].includes(String(row.tipo)) || !bool(row.activo) || !bool(row.controla_inventario) || !decimal(row.precio_venta) ||
    !text(unit.nombre) || !text(unit.codigo) || !bool(unit.activo) || !bool(unit.permite_decimales) || !Array.isArray(row.impuestos)) throw new Error('Producto del servidor no válido.')
  for (const item of row.impuestos) { const tax = entity(item); if (!decimal(tax.tasa) || !bool(tax.activo)) throw new Error('Impuesto del servidor no válido.') }
  return row as unknown as Product
}
function customer(value: unknown): Customer {
  const row = entity(value)
  if (!text(row.codigo) || !text(row.nombre) || !bool(row.activo) || !decimal(row.limite_credito) ||
    !Number.isSafeInteger(row.dias_credito) || !nullableText(row.rfc) || !nullableText(row.email) || !nullableText(row.telefono)) throw new Error('Cliente del servidor no válido.')
  return row as unknown as Customer
}
function warehouse(value: unknown): Warehouse {
  const row = entity(value), branch = entity(row.sucursal)
  if (!text(row.nombre) || !text(row.codigo) || !bool(row.activo) || !identifier(branch.empresa_id) ||
    !text(branch.nombre) || !text(branch.codigo) || !bool(branch.activo)) throw new Error('Almacén del servidor no válido.')
  return row as unknown as Warehouse
}
function stock(value: unknown): Stock {
  const row = record(value), item = entity(row.producto)
  if (!identifier(row.almacen_id) || !text(item.nombre) || !text(item.sku) || !bool(item.activo) || !decimal(row.cantidad) ||
    !decimal(row.reservado) || !decimal(row.disponible) || !bool(row.existencia_registrada) || !bool(row.bajo_minimo)) throw new Error('Existencia del servidor no válida.')
  return row as unknown as Stock
}
function method(value: unknown): PaymentMethod {
  const row = entity(value)
  if (!text(row.codigo) || !text(row.nombre) || !bool(row.activo) || !bool(row.es_efectivo)) throw new Error('Método de pago no válido.')
  return row as unknown as PaymentMethod
}
function cash(value: unknown): CashRegister {
  const row = entity(value)
  if (!identifier(row.sucursal_id) || !text(row.codigo) || !text(row.nombre) || !bool(row.activo)) throw new Error('Caja no válida.')
  return row as unknown as CashRegister
}
function cashSession(value: unknown): CashSession | null {
  if (value === null) return null
  const row = entity(value)
  if (!identifier(row.caja_id) || !identifier(row.usuario_apertura_id) || !text(row.estado) || !nullableText(row.fecha_cierre) || !decimal(row.monto_apertura)) throw new Error('Sesión de caja no válida.')
  return row as unknown as CashSession
}
function pathId(id: string) { if (!isSaleId(id)) throw new Error('Identificador no válido.'); return id }
function query(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)) })
  return '?' + params.toString()
}
async function get(path: `/${string}`, token: string, signal: AbortSignal) {
  const response = record(await apiRequest<unknown>(path, { token, signal }))
  if (response.ok !== true) throw new Error('El servidor no confirmó la consulta.')
  return response
}
async function list<T>(path: `/${string}`, token: string, signal: AbortSignal, parse: (value: unknown) => T, nested = false): Promise<Page<T>> {
  const response = await get(path, token, signal)
  const body = nested ? record(response.data) : response
  const paging = nested ? body : record(response.pagination)
  const rows = nested ? body.items : body.data
  if (!Array.isArray(rows)) throw new Error('Listado del servidor no válido.')
  return { items: rows.map(parse), total: validPage(paging.total), page: validPage(paging.page, true), size: validPage(nested ? paging.pageSize : paging.limit, true) }
}
export const commercialService = {
  products: (token: string, search: string, active: string, page: number, signal: AbortSignal) =>
    list(`/products${query({ search, activo: active, page, limit: 20 })}`, token, signal, product),
  customers: (token: string, search: string, active: string, page: number, signal: AbortSignal) =>
    list(`/customers${query({ q: search, activo: active, page, pageSize: 20 })}`, token, signal, customer, true),
  warehouses: (token: string, page: number, signal: AbortSignal) =>
    list(`/inventory/warehouses${query({ activo: 'true', page, limit: 100 })}`, token, signal, warehouse),
  stock: (token: string, warehouseId: string, search: string, page: number, signal: AbortSignal, productId?: string) =>
    list(`/inventory/stock${query({ almacen_id: pathId(warehouseId), search, producto_id: productId ? pathId(productId) : undefined, page, limit: 20, activo: 'true' })}`, token, signal, stock),
  methods: (token: string, page: number, signal: AbortSignal) =>
    list(`/payment-methods${query({ page, pageSize: 100, activo: 'true' })}`, token, signal, method, true),
  cash: (token: string, branch: string, page: number, signal: AbortSignal) =>
    list(`/cash${query({ sucursal_id: branch ? pathId(branch) : undefined, page, pageSize: 100 })}`, token, signal, cash, true),
  async currentSession(token: string, cashId: string, signal: AbortSignal) {
    return cashSession((await get(`/cash/${pathId(cashId)}/sessions/current`, token, signal)).data)
  },
  async recoverSale(token: string, key: string): Promise<CreatedSale> {
    const response = await get(('/sales/operations/' + encodeURIComponent(key)) as Parameters<typeof get>[0], token, new AbortController().signal)
    const row = entity(response.data)
    if (!text(row.folio) || !text(row.estado) || !text(row.condicion_pago) ||
      !['subtotal', 'descuento', 'impuesto', 'total'].every(key => typeof row[key] === 'number' && Number.isFinite(row[key]))) throw new Error('El resultado del intento no se pudo interpretar.')
    return row as unknown as CreatedSale
  },
  async createSale(token: string, body: SaleInput): Promise<CreatedSale> {
    const response = record(await apiRequest<unknown>('/sales', { token, method: 'POST', body }))
    const row = entity(response.data)
    if (response.ok !== true || !text(row.folio) || !text(row.estado) || !text(row.condicion_pago) ||
      !['subtotal', 'descuento', 'impuesto', 'total'].every((key) => typeof row[key] === 'number' && Number.isFinite(row[key]))) {
      throw new Error('La respuesta de registro no se pudo interpretar. Revisa el folio antes de reintentar.')
    }
    return row as unknown as CreatedSale
  },
}
