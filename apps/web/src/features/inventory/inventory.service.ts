import { apiRequest } from '../../services/api'
import { object, responseData, validId } from '../suppliers/supplier.parse'
import { dateBounds, normalizeInventoryAction } from './inventory.logic'
import { parseStock, parseInventoryPage, parseMovement, parseKardex, parseTransferSummary, parseTransferDetail, parseAdjustmentResult, parseTransferResult } from './inventory.parse'
import type { InventoryAttempt, InventoryResult } from './inventory.types'
function id(value: string) { if(!validId(value))throw new Error('Selecciona un almacén o producto válido.');return value }
function query(values: Record<string,string|number|undefined>) { const params=new URLSearchParams();Object.entries(values).forEach(([key,value])=>{if(value!==undefined&&value!=='')params.set(key,String(value))});return params.toString() }
export const inventoryService = {
  async stock(token:string,warehouseId:string,search:string,page:number,signal:AbortSignal,limit=20) {
    const value=await apiRequest(`/inventory/stock?${query({almacen_id:id(warehouseId),search,activo:'true',page,limit})}`,{token,signal})
    if(object(object(value).almacen).id!==warehouseId)throw new Error('La respuesta corresponde a otro almacén.')
    return parseInventoryPage(value,row=>parseStock(row,warehouseId),page,limit)
  },
  async movements(token:string,warehouseId:string,productId:string,type:string,from:string,to:string,page:number,signal:AbortSignal) {
    return parseInventoryPage(await apiRequest(`/inventory/movements?${query({almacen_id:id(warehouseId),producto_id:productId?id(productId):undefined,tipo:type,...dateBounds(from,to),page,limit:20})}`,{token,signal}),row=>parseMovement(row,warehouseId,productId),page)
  },
  async kardex(token:string,warehouseId:string,productId:string,from:string,to:string,page:number,signal:AbortSignal) {
    return parseKardex(await apiRequest(`/inventory/kardex?${query({almacen_id:id(warehouseId),producto_id:id(productId),...dateBounds(from,to),page,limit:20})}`,{token,signal}),warehouseId,productId,page)
  },
  async transfers(token:string,warehouseId:string,state:string,search:string,page:number,signal:AbortSignal) {
    return parseInventoryPage(await apiRequest(`/transfers?${query({almacen_id:id(warehouseId),estado:state,search,page,limit:20})}`,{token,signal}),parseTransferSummary,page)
  },
  async transferDetail(token:string,transferId:string,signal:AbortSignal) {return parseTransferDetail(responseData(await apiRequest(`/transfers/${id(transferId)}`,{token,signal})),transferId)},
  async run(token:string,attempt:InventoryAttempt):Promise<InventoryResult> {
    const action=normalizeInventoryAction(attempt.action)
    const path:`/${string}`=action.kind==='adjust'?'/inventory/adjustments':action.kind==='create-transfer'?'/transfers':`/transfers/${id(action.id)}/${action.kind==='complete-transfer'?'complete':'cancel'}`
    const result=await apiRequest(path,{token,method:'POST',body:action.body,idempotencyKey:attempt.key})
    if(typeof object(result).replayed!=='boolean')throw new Error('No se pudo comprobar la confirmación del intento.')
    return action.kind==='adjust'?{kind:'adjust',adjustment:parseAdjustmentResult(result,attempt)}:{kind:'transfer',transfer:parseTransferResult(result,attempt)}
  },
}
