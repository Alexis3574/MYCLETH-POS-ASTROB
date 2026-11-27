import { object, validId, nullableText, responseData } from '../suppliers/supplier.parse.ts'
import { decimal, scaled, signedUnits, movementDelta, movementTypes, destinationCost } from './inventory.logic.ts'
import type { Page, Warehouse } from '../commercial/commercial.types'
import type { AdjustmentResult, InventoryAttempt, InventoryMovement, InventoryState, InventoryStock, KardexData, KardexRow, TransferDetail, TransferMovement, TransferRecord, TransferSummary } from './inventory.types'
const fail = () => new Error('La respuesta de inventario no se pudo comprobar.')
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
function number(value: unknown, scale: number, signed = false): value is string { if (typeof value !== 'string') return false; try { if (signed) signedUnits(value,scale); else decimal(value,scale); return true } catch { return false } }
function nullableId(value: unknown) { return value === null || validId(value) }
function unit(value: unknown) { const row = object(value); if (!validId(row.id) || typeof row.codigo !== 'string' || typeof row.nombre !== 'string' || typeof row.permite_decimales !== 'boolean') throw fail(); return row }
export function parseState(value: unknown): InventoryState {
  const row = object(value)
  if (!number(row.cantidad,3) || !number(row.reservado,3) || !number(row.disponible,3,true) || !number(row.costo_promedio,4) || scaled(row.cantidad,3)-scaled(row.reservado,3)!==signedUnits(row.disponible)) throw fail()
  return row as unknown as InventoryState
}
export function parseStock(value: unknown, warehouseId: string): InventoryStock {
  parseState(value)
  const row = object(value), product = object(row.producto)
  unit(row.unidad)
  if (row.almacen_id !== warehouseId || !validId(product.id) || typeof product.nombre !== 'string' || typeof product.sku !== 'string' || !nullableText(product.codigo_barras) || typeof product.activo !== 'boolean' || typeof row.existencia_registrada !== 'boolean' || !number(row.stock_minimo,3) || !(row.stock_maximo === null || number(row.stock_maximo,3)) || typeof row.bajo_minimo !== 'boolean' || row.bajo_minimo !== (signedUnits(row.disponible as string)<scaled(row.stock_minimo,3)) || !(row.actualizado_en === null || date(row.actualizado_en))) throw fail()
  return row as unknown as InventoryStock
}
export function parseInventoryPage<T>(value: unknown, parse: (row: unknown) => T, page: number, limit = 20): Page<T> {
  const row = object(value), paging = object(row.pagination)
  if (row.ok !== true || !Array.isArray(row.data) || paging.page !== page || paging.limit !== limit || !Number.isSafeInteger(paging.total) || Number(paging.total)<0 || paging.total_pages !== Math.ceil(Number(paging.total)/limit) || row.data.length>limit || row.data.length>Number(paging.total)) throw fail()
  const items = row.data.map(entry => parse(entry))
  const ids = items.map(item => { const entry = object(item); return entry.id ?? object(entry.producto).id })
  if (new Set(ids).size!==ids.length) throw fail()
  return {items,total:Number(paging.total),page,size:limit}
}
function movementFields(value: unknown) {
  const row = object(value)
  if (!validId(row.id) || !movementTypes.includes(row.tipo as never) || !number(row.cantidad,3) || scaled(row.cantidad,3)<=0n || !(row.costo_unitario===null || number(row.costo_unitario,4)) || !nullableText(row.documento_tipo) || !nullableId(row.documento_id) || !nullableId(row.documento_detalle_id) || !nullableId(row.usuario_id) || !nullableText(row.motivo) || !date(row.fecha)) throw fail()
  return row
}
export function parseMovement(value: unknown, warehouseId: string, productId = ''): InventoryMovement {
  const row = movementFields(value), product = object(row.producto), warehouse = object(row.almacen)
  if (!validId(product.id) || productId && product.id!==productId || typeof product.sku!=='string' || typeof product.nombre!=='string' || warehouse.id!==warehouseId || !validId(warehouse.sucursal_id) || typeof warehouse.codigo!=='string' || typeof warehouse.nombre!=='string') throw fail()
  if (row.sincronizacion!==null) { const sync=object(row.sincronizacion);if(!validId(sync.id)||typeof sync.operation_id!=='string'||!Number.isSafeInteger(sync.adjustment)||typeof sync.estado!=='string'||!Number.isInteger(sync.intentos)||Number(sync.intentos)<0||!(sync.sincronizado_en===null||date(sync.sincronizado_en))) throw fail() }
  return row as unknown as InventoryMovement
}
export function parseKardex(value: unknown, warehouseId: string, productId: string, page: number): KardexData {
  const root=object(value),product=object(root.producto),warehouse=object(root.almacen),summary=object(root.resumen),period=object(root.periodo),current=object(root.existencia_actual)
  parseState(current)
  if(product.id!==productId||typeof product.nombre!=='string'||typeof product.sku!=='string'||warehouse.id!==warehouseId||typeof warehouse.nombre!=='string'||typeof warehouse.codigo!=='string'||typeof current.existencia_registrada!=='boolean'||!(period.fecha_desde===null||date(period.fecha_desde))||!(period.fecha_hasta===null||date(period.fecha_hasta))||summary.metodo_saldo!=='RECONSTRUIDO_DESDE_EXISTENCIA_ACTUAL'||!['saldo_base_reconstruido','saldo_inicial_periodo','saldo_final_periodo'].every(field=>number(summary[field],3,true))||!number(summary.entradas_periodo,3,true)||!number(summary.salidas_periodo,3,true))throw fail()
  if(signedUnits(summary.entradas_periodo)<0n||signedUnits(summary.salidas_periodo)<0n||signedUnits(summary.saldo_inicial_periodo as string)+signedUnits(summary.entradas_periodo)-signedUnits(summary.salidas_periodo)!==signedUnits(summary.saldo_final_periodo as string))throw fail()
  const result=parseInventoryPage(root,entry=>{
    const row=movementFields(entry)
    if(!number(row.delta,3,true)||!number(row.saldo_antes,3,true)||!number(row.saldo_despues,3,true)||signedUnits(row.delta)!==movementDelta(row.tipo as KardexRow['tipo'],row.cantidad as string)||signedUnits(row.saldo_antes)+signedUnits(row.delta)!==signedUnits(row.saldo_despues))throw fail()
    return row as unknown as KardexRow
  },page)
  result.items.forEach((row,index)=>{if(index && signedUnits(result.items[index-1].saldo_despues)!==signedUnits(row.saldo_antes))throw fail()})
  if(result.items.length&&page===1&&signedUnits(result.items[0].saldo_antes)!==signedUnits(summary.saldo_inicial_periodo as string))throw fail()
  if(result.items.length&&page===Math.ceil(result.total/result.size)&&signedUnits(result.items[result.items.length-1].saldo_despues)!==signedUnits(summary.saldo_final_periodo as string))throw fail()
  return {...root,rows:result.items,page,size:result.size,total:result.total} as unknown as KardexData
}
function warehouse(value: unknown): Warehouse {const row=object(value),branch=object(row.sucursal);if(!validId(row.id)||typeof row.codigo!=='string'||typeof row.nombre!=='string'||typeof row.activo!=='boolean'||!validId(branch.id)||!validId(branch.empresa_id)||typeof branch.nombre!=='string'||typeof branch.codigo!=='string'||typeof branch.activo!=='boolean')throw fail();return row as unknown as Warehouse}
export function parseTransferSummary(value: unknown): TransferSummary {
  const row=object(value),origin=warehouse(row.almacen_origen),destination=warehouse(row.almacen_destino)
  if(!validId(row.id)||!validId(row.empresa_id)||!validId(row.usuario_id)||typeof row.folio!=='string'||!row.folio||!['BORRADOR','COMPLETADA','CANCELADA'].includes(String(row.estado))||!date(row.fecha)||!nullableText(row.observaciones)||origin.id===destination.id||origin.sucursal.empresa_id!==row.empresa_id||destination.sucursal.empresa_id!==row.empresa_id||!Number.isInteger(row.total_productos)||Number(row.total_productos)<1||Number(row.total_productos)>100)throw fail()
  return row as unknown as TransferSummary
}
export function parseTransfer(value: unknown, expectedId?: string): TransferRecord {
  const record=parseTransferSummary(value),row=object(value),ids=new Set(),products=new Set()
  if(expectedId!==undefined&&record.id!==expectedId||!Array.isArray(row.detalles)||row.detalles.length!==record.total_productos)throw fail()
  for(const entry of row.detalles){const line=object(entry),product=object(line.producto);unit(product.unidad);if(!validId(line.id)||ids.has(line.id)||!validId(line.producto_id)||products.has(line.producto_id)||product.id!==line.producto_id||typeof product.nombre!=='string'||typeof product.sku!=='string'||typeof product.activo!=='boolean'||!number(line.cantidad,3)||scaled(line.cantidad,3)<=0n)throw fail();ids.add(line.id);products.add(line.producto_id)}
  return row as unknown as TransferRecord
}
function transferMovements(value: unknown): TransferMovement[] {
  if(!Array.isArray(value))throw fail()
  const ids=new Set()
  for(const entry of value){const row=object(entry);if(!validId(row.id)||ids.has(row.id)||!validId(row.producto_id)||!validId(row.almacen_id)||!['TRANSFERENCIA_SALIDA','TRANSFERENCIA_ENTRADA'].includes(String(row.tipo))||!number(row.cantidad,3)||scaled(row.cantidad,3)<=0n||!(row.costo_unitario===null||number(row.costo_unitario,4))||!nullableId(row.documento_detalle_id)||!date(row.fecha))throw fail();ids.add(row.id)}
  return value as TransferMovement[]
}
function verifyTransferMovements(record: TransferRecord, rows: TransferMovement[]) {
  if(record.estado!=='COMPLETADA'){if(rows.length)throw fail();return}
  if(rows.length!==record.detalles.length*2)throw fail()
  for(const line of record.detalles){const pair=rows.filter(row=>row.documento_detalle_id===line.id&&row.producto_id===line.producto_id&&scaled(row.cantidad,3)===scaled(line.cantidad,3));if(pair.filter(row=>row.tipo==='TRANSFERENCIA_SALIDA'&&row.almacen_id===record.almacen_origen.id).length!==1||pair.filter(row=>row.tipo==='TRANSFERENCIA_ENTRADA'&&row.almacen_id===record.almacen_destino.id).length!==1)throw fail()}
}
export function parseTransferDetail(value: unknown, id: string): TransferDetail {
  const record=parseTransfer(value,id),row=object(value),rows=transferMovements(row.movimientos)
  verifyTransferMovements(record,rows)
  if(!Array.isArray(row.operaciones))throw fail()
  const ids=new Set()
  for(const entry of row.operaciones){const op=object(entry);if(!validId(op.id)||ids.has(op.id)||!validId(op.usuario_id)||!['CREAR','COMPLETAR','CANCELAR'].includes(String(op.accion))||!date(op.fecha))throw fail();ids.add(op.id)}
  return row as unknown as TransferDetail
}
export function parseAdjustmentResult(value: unknown, attempt: InventoryAttempt): AdjustmentResult {
  const row=object(responseData(value)),input=attempt.action
  if(input.kind!=='adjust')throw fail()
  const before=parseState(row.existencia_antes),after=parseState(row.existencia_despues),sync=object(row.sincronizacion)
  if(!validId(row.ajuste_id)||!validId(row.movimiento_id)||row.empresa_id!==attempt.companyId||row.usuario_id!==attempt.userId||row.clave_idempotencia!==attempt.key||row.almacen_id!==input.body.almacen_id||row.producto_id!==input.body.producto_id||row.tipo!==input.body.tipo||row.cantidad!==input.body.cantidad||row.costo_unitario!==input.body.costo_unitario||row.motivo!==input.body.motivo||!date(row.fecha)||sync.solicitada!==input.body.sincronizar_ecommerce||signedUnits(after.cantidad)-signedUnits(before.cantidad)!==movementDelta(input.body.tipo,input.body.cantidad)||signedUnits(after.reservado)!==signedUnits(before.reservado))throw fail()
  if(sync.solicitada?(!validId(sync.evento_id)||typeof sync.operation_id!=='string'||typeof sync.estado_al_crear!=='string'):(sync.evento_id!==null||sync.operation_id!==null||sync.estado_al_crear!==null))throw fail()
  return row as unknown as AdjustmentResult
}
export function parseTransferResult(value: unknown, attempt: InventoryAttempt): TransferRecord {
  const root=object(responseData(value)),op=object(root.operacion),record=parseTransfer(root.transferencia),action=attempt.action
  if(action.kind==='adjust')throw fail()
  const expected=action.kind==='create-transfer'?'CREAR':action.kind==='complete-transfer'?'COMPLETAR':'CANCELAR'
  if(op.accion!==expected||op.clave_idempotencia!==attempt.key||op.usuario_id!==attempt.userId||!date(op.fecha)||record.empresa_id!==attempt.companyId||record.estado!==(expected==='CREAR'?'BORRADOR':expected==='COMPLETAR'?'COMPLETADA':'CANCELADA'))throw fail()
  if(action.kind==='create-transfer'){
    const content=(rows:{producto_id:string;cantidad:string}[])=>JSON.stringify(rows.map(row=>[row.producto_id,scaled(row.cantidad,3).toString()]).sort((a,b)=>a[0].localeCompare(b[0])))
    if(record.usuario_id!==attempt.userId||record.almacen_origen.id!==action.body.almacen_origen_id||record.almacen_destino.id!==action.body.almacen_destino_id||record.folio!==(action.body.folio??'TR-'+attempt.key)||record.observaciones!==action.body.observaciones||content(record.detalles)!==content(action.body.detalles))throw fail()
  }else if(record.id!==action.id||action.kind==='cancel-transfer'&&op.motivo!==action.body.motivo)throw fail()
  const rows=transferMovements(root.movimientos);verifyTransferMovements(record,rows)
  const ecommerce=object(root.ecommerce)
  if(ecommerce.eventos_creados!==0||ecommerce.politica!=='SIN_EVENTOS_ALMACENES_PENDIENTES'||!Array.isArray(root.existencias)||root.existencias.length!==(expected==='COMPLETAR'?record.detalles.length:0))throw fail()
  const seen=new Set()
  for(const entry of root.existencias){const change=object(entry),origin=object(change.origen),destination=object(change.destino),line=record.detalles.find(item=>item.producto_id===change.producto_id)
    if(!line||seen.has(line.producto_id)||change.cantidad!==line.cantidad||origin.almacen_id!==record.almacen_origen.id||destination.almacen_id!==record.almacen_destino.id||!number(change.costo_unitario,4))throw fail()
    const a=parseState(origin.antes),b=parseState(origin.despues),c=parseState(destination.antes),d=parseState(destination.despues),q=scaled(line.cantidad,3)
    if(signedUnits(b.cantidad)!==signedUnits(a.cantidad)-q||signedUnits(d.cantidad)!==signedUnits(c.cantidad)+q||q>signedUnits(a.disponible)||a.reservado!==b.reservado||c.reservado!==d.reservado||change.costo_unitario!==a.costo_promedio||b.costo_promedio!==a.costo_promedio||d.costo_promedio!==destinationCost(c.cantidad,c.costo_promedio,line.cantidad,a.costo_promedio)||rows.filter(row=>row.producto_id===line.producto_id).some(row=>row.costo_unitario!==a.costo_promedio))throw fail();seen.add(line.producto_id)
  }
  return record
}
