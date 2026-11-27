import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import { apiRequest } from '../../services/api'
import { useAuthSession } from '../auth/useAuthSession'
import { usePermission } from '../commercial/commercial.hooks'
import { useRemoteResource } from '../../hooks/useRemoteResource'
import CustomerBrowser from '../customers/CustomerBrowser'
import type { Customer } from '../commercial/commercial.types'
import Pagination from '../commercial/Pagination'
import QueryFeedback from '../commercial/QueryFeedback'
import { salesService } from '../sales/sales.service'
import type { SaleListItem } from '../sales/sales.types'
import { record, identifier } from '../quotations/document.logic'
import { creditSummary } from './credit.logic'
import { formatSaleAmount, formatSaleDate } from '../sales/sales.query'
import '../../pages/SalesPage.css'
import '../../pages/CommercialPage.css'
import '../quotations/workflows.css'
export default function CreditsWorkspace(){const auth=useAuthSession();return auth?<Credits key={auth.accessToken}/>:null}
function Credits(){
 const allowed=usePermission('VENTAS.VER'),[page,setPage]=useState(1),[customer,setCustomer]=useState<Customer|null>(null),[choosing,setChoosing]=useState(false),[selected,setSelected]=useState(''),[revision,setRevision]=useState(0)
 const load=useCallback(async(token:string,signal:AbortSignal)=>{
  const params=new URLSearchParams({condicion_pago:'CREDITO',page:String(page),limit:'20'});if(customer)params.set('cliente_id',customer.id)
  const response=record(await apiRequest(`/sales?${params}`,{token,signal})),paging=record(response.pagination)
  if(response.ok!==true||!Array.isArray(response.data)||paging.page!==page||paging.limit!==20||!Number.isSafeInteger(paging.total)||Number(paging.total)<0)throw new Error('Listado de crédito no válido.')
  const items=response.data.map(value=>{const row=record(value);identifier(row.id);if(row.condicion_pago!=='CREDITO'||typeof row.total!=='number'||!Number.isFinite(row.total)||row.total<0||typeof row.folio!=='string'||typeof row.fecha!=='string'||Number.isNaN(Date.parse(row.fecha)))throw new Error('Venta a crédito no válida.');const client=record(row.cliente);identifier(client.id);if(customer&&client.id!==customer.id)throw new Error('Cliente ajeno al filtro.');return row as unknown as SaleListItem})
  if(new Set(items.map(row=>row.id)).size!==items.length)throw new Error('Ventas duplicadas.')
  return{items,page,size:20,total:Number(paging.total)}
 },[page,customer])
 const list=useRemoteResource('credits:'+page+':'+customer?.id+':'+revision,allowed,load)
 const financialLoad=useCallback(async(token:string,signal:AbortSignal)=>creditSummary(await salesService.financial(token,selected,signal),selected),[selected])
 const financial=useRemoteResource('credit-financial:'+selected+':'+revision,allowed&&!!selected,financialLoad)
 return <section className="commercial-page"><header className="sales-heading"><div><p className="sales-eyebrow">CONSULTA FINANCIERA</p><h1>Ventas a crédito</h1><p>Importes documentales y condiciones configuradas del cliente.</p></div></header>
 {!allowed?<p role="alert">No tienes permiso para consultar ventas a crédito.</p>:<>
 <section className="commercial-panel"><h2>Cuentas por cobrar: integración pendiente</h2><p>La API actual no registra abonos ni ofrece una cartera por cobrar. El crédito neto mostrado refleja el documento, sus devoluciones y cancelación; no representa deuda pendiente, crédito disponible ni vencimientos confirmados.</p></section>
 <section className="commercial-panel"><p>Cliente: {customer?.nombre??'Todos'}</p>{customer&&<p>Límite configurado {customer.limite_credito} · Plazo configurado {customer.dias_credito} días. No representan disponibilidad o saldo.</p>}<div className="commercial-actions"><button type="button" className="sales-button sales-button--secondary" onClick={()=>setChoosing(!choosing)}>Filtrar crédito por cliente</button>{customer&&<button type="button" className="sales-button sales-button--secondary" onClick={()=>{setCustomer(null);setSelected('');setPage(1)}}>Quitar filtro de cliente</button>}<button type="button" className="sales-button sales-button--secondary" onClick={()=>setRevision(x=>x+1)}>Actualizar crédito</button></div></section>
 {choosing&&<CustomerBrowser onSelect={value=>{setCustomer(value);setSelected('');setPage(1);setChoosing(false)}}/>}
 <QueryFeedback resource={list}/>{list.data&&<section className="commercial-panel"><div className="sales-table-scroll"><table className="sales-table"><caption>Ventas con condición crédito</caption><thead><tr><th>Folio / fecha UTC</th><th>Cliente</th><th>Estado</th><th>Total de venta</th><th>Crédito</th></tr></thead><tbody>{list.data.items.map(row=><tr key={row.id}><td><Link to={'/sales/'+row.id}>{row.folio}</Link><small>{formatSaleDate(row.fecha)}</small></td><td>{row.cliente?.nombre}</td><td>{row.estado}</td><td>{formatSaleAmount(row.total)}</td><td><button type="button" className="sales-button sales-button--secondary" onClick={()=>setSelected(row.id)}>Consultar crédito {row.folio}</button></td></tr>)}</tbody></table></div>{!list.data.items.length&&<p role="status">No hay ventas a crédito con estos filtros.</p>}<Pagination {...list.data} onChange={value=>{setPage(value);setSelected('')}}/></section>}
 {selected&&<section className="commercial-panel"><h2>Crédito del documento seleccionado</h2><QueryFeedback resource={financial}/>{financial.data&&<><dl><dt>Crédito original</dt><dd>{financial.data.original}</dd><dt>Crédito devuelto</dt><dd>{financial.data.returned}</dd><dt>Crédito neto documental</dt><dd>{financial.data.net}</dd></dl>{financial.data.client&&<p>Cliente: {String(financial.data.client.nombre)} · Límite {String(financial.data.client.limite_credito??'No informado')} · Plazo {String(financial.data.client.dias_credito??'No informado')} días</p>}</>}</section>}
 </>}
 </section>
}
