import { record, identifier } from '../quotations/document.logic.ts'
import { decimal, scaled } from '../purchases/purchase.logic.ts'
export function creditSummary(value:unknown,saleId:string){
 const data=record(value),sale=record(data.venta),credit=record(data.credito)
 if(sale.id!==identifier(saleId)||sale.condicion_pago!=='CREDITO'||credit.cuentas_por_cobrar_integrado!==false)throw new Error('Contrato de crédito no reconocido.')
 const amounts=['monto_original','monto_devuelto','monto_neto_post_devoluciones']as const
 for(const key of amounts)if(typeof credit[key]!=='number'||!Number.isFinite(credit[key]))throw new Error('Importe de crédito no válido.')
 const original=decimal(String(credit.monto_original),2),returned=decimal(String(credit.monto_devuelto),2),net=decimal(String(credit.monto_neto_post_devoluciones),2)
 if(scaled(returned,2)>scaled(original,2)||scaled(net,2)!==(sale.estado==='CANCELADA'?0n:scaled(original,2)-scaled(returned,2)))throw new Error('Crédito documental inconsistente.')
 const client=credit.cliente===null?null:record(credit.cliente)
 if(client){identifier(client.id);if(typeof client.nombre!=='string')throw new Error('Cliente de crédito no válido.')}
 return{original,returned,net,client}
}
