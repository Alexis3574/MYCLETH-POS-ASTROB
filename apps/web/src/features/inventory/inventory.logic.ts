import { decimal, scaled } from '../purchases/purchase.logic.ts'
import { isSaleId } from '../sales/sales.query.ts'
import type { AdjustmentInput, InventoryAction, InventoryAttempt, InventoryStock, MovementType, TransferInput } from './inventory.types'
import type { Page } from '../commercial/commercial.types'
export { decimal, scaled }
export const movementTypes: MovementType[] = ['ENTRADA','SALIDA','AJUSTE_POSITIVO','AJUSTE_NEGATIVO','TRANSFERENCIA_ENTRADA','TRANSFERENCIA_SALIDA']
export const inventoryLabels:Record<string,string>={ENTRADA:'Entrada',SALIDA:'Salida',AJUSTE_POSITIVO:'Ajuste positivo',AJUSTE_NEGATIVO:'Ajuste negativo',TRANSFERENCIA_ENTRADA:'Entrada por traspaso',TRANSFERENCIA_SALIDA:'Salida por traspaso',BORRADOR:'Borrador',COMPLETADA:'Completada',CANCELADA:'Cancelada'}
export function signedUnits(value: string, scale = 3): bigint {
  const match = /^(-?)(\d{1,30})(?:\.(\d+))?$/.exec(value)
  if (!match || (match[3] ?? '').length > scale) throw new Error('Decimal de inventario no válido.')
  return scaled(match[2] + '.' + (match[3] ?? '').padEnd(scale,'0'), scale) * (match[1] ? -1n : 1n)
}
export function unitsText(value: bigint, scale = 3) { const absolute = value < 0n ? -value : value; return (value < 0n ? '-' : '') + absolute / 10n ** BigInt(scale) + '.' + String(absolute % 10n ** BigInt(scale)).padStart(scale,'0') }
export function movementDelta(type: MovementType, quantity: string) { return scaled(quantity,3) * (['ENTRADA','AJUSTE_POSITIVO','TRANSFERENCIA_ENTRADA'].includes(type) ? 1n : -1n) }
export function destinationCost(quantityBefore:string,costBefore:string,incomingQuantity:string,sourceCost:string) {
  const previous=scaled(quantityBefore,3),incoming=scaled(incomingQuantity,3),denominator=previous+incoming
  if(denominator<=0n)throw new Error('La entrada requiere cantidad positiva.')
  const numerator=previous*scaled(costBefore,4)+incoming*scaled(sourceCost,4)
  return unitsText((2n*numerator+denominator)/(2n*denominator),4)
}
function id(value: string) { if (typeof value !== 'string' || !isSaleId(value)) throw new Error('Selecciona un registro válido.'); return value }
function text(value: string, max: number, required = false) { const result = value.trim(); if (result.length > max || required && !result) throw new Error(`Revisa el campo obligatorio y su límite de ${max} caracteres.`); return result }
export function normalizeAdjustment(body: AdjustmentInput): AdjustmentInput {
  id(body.almacen_id); id(body.producto_id)
  if (!['AJUSTE_POSITIVO','AJUSTE_NEGATIVO'].includes(body.tipo) || typeof body.sincronizar_ecommerce !== 'boolean') throw new Error('Tipo de ajuste no válido.')
  const quantity = decimal(body.cantidad,3,true), cost = body.costo_unitario === null ? null : decimal(body.costo_unitario,4)
  if (body.tipo === 'AJUSTE_NEGATIVO' && cost !== null) throw new Error('Un ajuste negativo no recibe costo unitario.')
  if (body.sincronizar_ecommerce && (scaled(quantity,3) % 1000n !== 0n || scaled(quantity,3) > 2147483647000n)) throw new Error('La sincronización exige cantidad entera entre 1 y 2147483647.')
  return { almacen_id: body.almacen_id, producto_id: body.producto_id, tipo: body.tipo, cantidad: quantity, costo_unitario: cost, motivo: text(body.motivo,1000,true), sincronizar_ecommerce: body.sincronizar_ecommerce }
}
export function validateAdjustment(body: AdjustmentInput, stock: InventoryStock) {
  const input = normalizeAdjustment(body), quantity = scaled(input.cantidad,3)
  if (input.almacen_id !== stock.almacen_id || input.producto_id !== stock.producto.id || !stock.producto.activo) throw new Error('Selecciona existencias vigentes de un producto activo.')
  if (!stock.unidad.permite_decimales && quantity % 1000n) throw new Error('La unidad de este producto requiere cantidades enteras.')
  if (input.sincronizar_ecommerce && !stock.producto.codigo_barras?.trim()) throw new Error('La sincronización requiere código de barras registrado.')
  if (input.tipo === 'AJUSTE_NEGATIVO' && quantity > signedUnits(stock.disponible)) throw new Error('El ajuste supera la cantidad disponible; las reservas no pueden retirarse.')
  if (input.tipo === 'AJUSTE_POSITIVO' && signedUnits(stock.cantidad) + quantity > 99999999999999n) throw new Error('El ajuste supera el límite de existencias.')
  return input
}
export function normalizeTransfer(body: TransferInput): TransferInput {
  id(body.almacen_origen_id); id(body.almacen_destino_id)
  if (body.almacen_origen_id === body.almacen_destino_id) throw new Error('Origen y destino deben ser distintos.')
  if (!Array.isArray(body.detalles) || !body.detalles.length || body.detalles.length > 100) throw new Error('Selecciona entre 1 y 100 productos distintos.')
  const seen = new Set<string>()
  return { almacen_origen_id: body.almacen_origen_id, almacen_destino_id: body.almacen_destino_id, ...(body.folio === undefined ? {} : { folio: text(body.folio,50,true) }), observaciones: body.observaciones === null ? null : text(body.observaciones,1000,true), detalles: body.detalles.map(line => { id(line.producto_id); if (seen.has(line.producto_id)) throw new Error('El traspaso contiene productos repetidos.'); seen.add(line.producto_id); return { producto_id: line.producto_id, cantidad: decimal(line.cantidad,3,true) } }) }
}
export function normalizeInventoryAction(action: InventoryAction): InventoryAction {
  if (action.kind === 'adjust') return { kind: action.kind, body: normalizeAdjustment(action.body) }
  if (action.kind === 'create-transfer') return { kind: action.kind, body: normalizeTransfer(action.body) }
  id(action.id)
  if (action.kind === 'complete-transfer') return { kind: action.kind, id: action.id, body: {} }
  if (action.kind === 'cancel-transfer') return { kind: action.kind, id: action.id, body: { motivo: text(action.body.motivo,1000,true) } }
  throw new Error('Operación de inventario no válida.')
}
export function inventoryAlerts(row: InventoryStock) {
  const available = signedUnits(row.disponible), flags: string[] = []
  if (available <= 0n) flags.push('Agotado')
  if (row.bajo_minimo) flags.push('Bajo mínimo')
  if (row.stock_maximo !== null && signedUnits(row.cantidad) > signedUnits(row.stock_maximo)) flags.push('Sobre máximo')
  if (!row.existencia_registrada) flags.push('Sin existencia registrada')
  return flags
}
export function dateBounds(from: string, to: string) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value
  if (from && !valid(from) || to && !valid(to) || from && to && from > to) throw new Error('Revisa el rango de fechas UTC.')
  return { ...(from ? { fecha_desde: from+'T00:00:00.000Z' } : {}), ...(to ? { fecha_hasta: to+'T23:59:59.999Z' } : {}) }
}
const key = 'posmycleth.inventory.pending.v1'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function readInventoryAttempt(storage: Pick<Storage,'getItem'>): InventoryAttempt | 'unreadable' | null {
  try { const raw = storage.getItem(key); if (raw === null) return null; const row = JSON.parse(raw) as InventoryAttempt
    if (row && typeof row.companyId === 'string' && isSaleId(row.companyId) && typeof row.userId === 'string' && isSaleId(row.userId) && typeof row.key === 'string' && uuid.test(row.key) && JSON.stringify(normalizeInventoryAction(row.action)) === JSON.stringify(row.action)) return row
  } catch { /* Bloquear un intento ilegible. */ }
  return 'unreadable'
}
export function saveInventoryAttempt(storage: Pick<Storage,'setItem'>, attempt: InventoryAttempt) { storage.setItem(key,JSON.stringify(attempt)) }
export function clearInventoryAttempt(storage: Pick<Storage,'removeItem'>) { storage.removeItem(key) }
export async function scanInventoryAlerts(load:(page:number)=>Promise<Page<InventoryStock>>) {
  const ids=new Set<string>(),alerts:InventoryStock[]=[]
  let total:number|null=null
  for(let page=1;page<=500;page++) {
    const result=await load(page)
    if(total!==null&&total!==result.total)throw new Error('El catálogo cambió durante la revisión. Actualiza las alertas.')
    total=result.total
    for(const row of result.items){if(ids.has(row.producto.id))throw new Error('El catálogo cambió durante la revisión. Actualiza las alertas.');ids.add(row.producto.id);if(inventoryAlerts(row).length)alerts.push(row)}
    if(ids.size===total)return {items:alerts,reviewed:ids.size}
    if(!result.items.length||ids.size>total)break
  }
  throw new Error('No se pudo revisar todo el catálogo. Las alertas no se presentan como una revisión completa.')
}
