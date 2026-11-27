import { decimal, scaled, estimatePurchase } from '../purchases/purchase.logic.ts'
export type DocKind = 'quotes' | 'sales-orders' | 'customer-orders'
export const docConfig = {
  quotes: { title: 'Cotizaciones', singular: 'cotización', permission: 'COTIZACIONES', field: 'cotizacion_detalle', date: 'valida_hasta', initial: 'BORRADOR', states: ['BORRADOR','ENVIADA','ACEPTADA','RECHAZADA','VENCIDA','CONVERTIDA','CANCELADA'] },
  'sales-orders': { title: 'Órdenes de venta', singular: 'orden', permission: 'ORDENES', field: 'orden_venta_detalle', date: 'fecha_compromiso', initial: 'PENDIENTE', states: ['PENDIENTE','EN_PROCESO','LISTA','FACTURADA','CANCELADA'] },
  'customer-orders': { title: 'Pedidos', singular: 'pedido', permission: 'PEDIDOS', field: 'pedido_cliente_detalle', date: 'fecha_entrega', initial: 'PENDIENTE', states: ['PENDIENTE','CONFIRMADO','EN_PREPARACION','LISTO','ENTREGADO','FACTURADO','CANCELADO'] },
} as const
export interface Location { id: string; codigo: string; nombre: string }
export interface DocLine {
  id: string; producto_id: string; descripcion: string | null; cantidad: string; precio_unitario: string
  descuento_porcentaje: string; tasa_impuesto: string; subtotal_linea: string; descuento_importe: string
  impuesto_importe: string; total_linea: string; producto: { id: string; sku: string; nombre: string }
}
export interface Document {
  id: string; empresa_id: string; sucursal_id: string; cliente_id: string | null; usuario_id: string
  folio: string; fecha: string; estado: string; observaciones: string | null; date: string | null
  referencia_cliente: string | null; cotizacion_id: string | null; sucursal: Location; cliente: Location | null
  subtotal: string; descuento: string; impuesto: string; total: string; lines: DocLine[]
}
export const record = (value: unknown): Record<string,unknown> => {
  if(!value || typeof value !== 'object' || Array.isArray(value))throw new Error('Respuesta del servidor no válida.')
  return value as Record<string,unknown>
}
export function identifier(value: unknown): string {
  if(typeof value!=='string'||!/^[1-9]\d{0,18}$/.test(value)||BigInt(value)>9223372036854775807n)throw new Error('Identificador no válido.')
  return value
}
export function text(value: unknown, max=2000, optional=false): string {
  if(typeof value!=='string'||value.trim().length>max||!optional&&!value.trim())throw new Error('Texto requerido o fuera del límite.')
  return value.trim()
}
export function calendar(value: string): string | null {
  if(!value)return null
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00.000Z'))||new Date(value+'T00:00:00.000Z').toISOString().slice(0,10)!==value)throw new Error('Fecha de calendario no válida.')
  return value
}
export function folio(value: string): string {const result=text(value,50);if(!/^[\p{L}\p{N}_./-]+$/u.test(result))throw new Error('El folio admite letras, números y _ . / -');return result}
export function documentActions(kind: DocKind, state: string): Array<[string,string]> {
  if(kind==='quotes')return state==='BORRADOR'?[['send','Marcar enviada'],['cancel','Cancelar cotización']]:state==='ENVIADA'?[['accept','Aceptar cotización'],['reject','Rechazar cotización'],['expire','Marcar vencida'],['cancel','Cancelar cotización']]:[]
  if(kind==='sales-orders')return state==='PENDIENTE'?[['start','Iniciar orden'],['cancel','Cancelar orden']]:state==='EN_PROCESO'?[['ready','Marcar lista'],['cancel','Cancelar orden']]:state==='LISTA'?[['cancel','Cancelar orden']]:[]
  return state==='PENDIENTE'?[['confirm','Confirmar pedido'],['cancel','Cancelar pedido']]:state==='CONFIRMADO'?[['prepare','Preparar pedido'],['cancel','Cancelar pedido']]:state==='EN_PREPARACION'?[['ready','Marcar listo'],['cancel','Cancelar pedido']]:state==='LISTO'?[['deliver','Registrar entrega'],['cancel','Cancelar pedido']]:[]
}
const location=(value: unknown): Location=>{const row=record(value);return{id:identifier(row.id),codigo:text(row.codigo,80),nombre:text(row.nombre,250)}}
function amount(value: unknown, scale: number){if(typeof value!=='string'&&typeof value!=='number')throw new Error('Importe inválido.');return decimal(String(value),scale)}
export function parseDocument(value: unknown, kind: DocKind, companyId: string): Document {
  const row=record(value),config=docConfig[kind],id=identifier(row.id),branch=location(row.sucursal),client=row.cliente===null?null:location(row.cliente)
  if(row.empresa_id!==companyId||row.sucursal_id!==branch.id||row.cliente_id!==(client?.id??null)||!config.states.some(state=>state===row.estado)||typeof row.fecha!=='string'||Number.isNaN(Date.parse(row.fecha)))throw new Error('Documento de otro contexto o estado no válido.')
  if(kind==='customer-orders'&&!client)throw new Error('El pedido requiere cliente.')
  const raw=row[config.field];if(!Array.isArray(raw)||!raw.length||raw.length>100)throw new Error('Partidas del documento no válidas.')
  const ids=new Set<string>(),products=new Set<string>()
  const lines=raw.map(value=>{
    const line=record(value),product=record(line.producto),lineId=identifier(line.id),productId=identifier(line.producto_id)
    const parentField=kind==='quotes'?'cotizacion_id':kind==='sales-orders'?'orden_venta_id':'pedido_cliente_id'
    if(line[parentField]!==id||product.id!==productId||ids.has(lineId)||products.has(productId))throw new Error('Partida duplicada o inconsistente.')
    ids.add(lineId);products.add(productId)
    const parsed={id:lineId,producto_id:productId,descripcion:line.descripcion===null?null:text(line.descripcion,250,true),cantidad:amount(line.cantidad,3),precio_unitario:amount(line.precio_unitario,4),descuento_porcentaje:amount(line.descuento_porcentaje,4),tasa_impuesto:amount(line.tasa_impuesto,4),subtotal_linea:amount(line.subtotal_linea,2),descuento_importe:amount(line.descuento_importe,2),impuesto_importe:amount(line.impuesto_importe,2),total_linea:amount(line.total_linea,2),producto:{id:productId,sku:text(product.sku,100),nombre:text(product.nombre,250)}}
    if(scaled(parsed.cantidad,3)<=0n||scaled(parsed.descuento_porcentaje,4)>1000000n||scaled(parsed.tasa_impuesto,4)>1000000n)throw new Error('Cantidad o porcentaje inválido.')
    const expected=estimatePurchase([parsed]);if(expected.subtotal!==parsed.subtotal_linea||expected.descuento!==parsed.descuento_importe||expected.impuesto!==parsed.impuesto_importe||expected.total!==parsed.total_linea)throw new Error('Importes de partida inconsistentes.')
    return parsed
  })
  const totals=estimatePurchase(lines)
  for(const key of ['subtotal','descuento','impuesto','total'] as const)if(totals[key]!==amount(row[key],2))throw new Error('Totales de documento inconsistentes.')
  const rawDate=row[config.date],date=rawDate===null?null:calendar(text(rawDate,40).slice(0,10))
  return{id,empresa_id:companyId,sucursal_id:branch.id,cliente_id:client?.id??null,usuario_id:identifier(row.usuario_id),folio:folio(text(row.folio,50)),fecha:row.fecha,estado:String(row.estado),observaciones:row.observaciones===null?null:text(row.observaciones,2000,true),date,referencia_cliente:kind==='customer-orders'&&row.referencia_cliente!==null?text(row.referencia_cliente,100,true):null,cotizacion_id:kind==='sales-orders'&&row.cotizacion_id!==null?identifier(row.cotizacion_id):null,sucursal:branch,cliente:client,...totals,lines}
}
export function normalizeLines(lines: Array<{producto_id:string;cantidad:string;descuento_porcentaje:string;descripcion:string|null}>) {
  if(!lines.length||lines.length>100||new Set(lines.map(row=>row.producto_id)).size!==lines.length)throw new Error('Agrega entre 1 y 100 productos sin repetir.')
  return lines.map(row=>{const discount=decimal(row.descuento_porcentaje,4);if(scaled(discount,4)>1000000n)throw new Error('El descuento supera 100%.');return{producto_id:identifier(row.producto_id),cantidad:decimal(row.cantidad,3,true),descuento_porcentaje:discount,descripcion:row.descripcion===null?null:text(row.descripcion,250,true)}})
}
