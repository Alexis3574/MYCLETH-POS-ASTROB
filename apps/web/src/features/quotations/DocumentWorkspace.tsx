import { Fragment, useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuthSession } from '../auth/useAuthSession'
import { usePermission } from '../commercial/commercial.hooks'
import { useRemoteResource } from '../../hooks/useRemoteResource'
import QueryFeedback from '../commercial/QueryFeedback'
import Pagination from '../commercial/Pagination'
import { docConfig, documentActions, identifier, parseDocument, record } from './document.logic'
import type { DocKind } from './document.logic'
import { documentService } from './document.service'
import { useSafeMutation } from './useSafeMutation'
import DocumentEditor from './DocumentEditor'
import DocumentConversion from './DocumentConversion'
import { decimal } from '../purchases/purchase.logic'
import { formatSaleAmount, formatSaleDate } from '../sales/sales.query'
import '../../pages/SalesPage.css'
import '../../pages/CommercialPage.css'
import '../purchases/purchases.css'
import './workflows.css'
export default function DocumentWorkspace({kind}:{kind:DocKind}){const auth=useAuthSession();return auth?<Workspace key={kind+auth.accessToken} kind={kind}/>:null}
function Workspace({kind}:{kind:DocKind}){
 const auth=useAuthSession()!,company=auth.user.empresa.id,config=docConfig[kind],allowed=usePermission(config.permission+'.VER'),canWrite=usePermission(config.permission+'.CREAR'),canOrder=usePermission('ORDENES.CREAR'),canSell=usePermission('VENTAS.CREAR')
 const {documentId=''}=useParams(),[params,setParams]=useSearchParams(),navigate=useNavigate(),[revision,setRevision]=useState(0),[mode,setMode]=useState<'view'|'edit'|'convert'>('view'),[notice,setNotice]=useState(''),[query,setQuery]=useState(params.get('q')??'')
 const state=params.get('estado')??'',q=params.get('q')??'',page=Number(params.get('page')??'1'),validPage=Number.isSafeInteger(page)&&page>=1&&page<=1000000,validState=!state||config.states.some(value=>value===state),validQuery=q.length<=50
 let validId=true;if(documentId&&documentId!=='new')try{identifier(documentId)}catch{validId=false}
 const loadList=useCallback((token:string,signal:AbortSignal)=>documentService.list(token,kind,company,state,q,page,signal),[kind,company,state,q,page])
 const loadDetail=useCallback((token:string,signal:AbortSignal)=>documentService.detail(token,kind,company,documentId,signal),[kind,company,documentId])
 const list=useRemoteResource(`doc-list:${kind}:${state}:${q}:${page}:${revision}`,allowed&&!documentId&&validPage&&validState&&validQuery,loadList)
 const detail=useRemoteResource(`doc-detail:${kind}:${documentId}:${revision}`,allowed&&!!documentId&&documentId!=='new'&&validId,loadDetail),doc=detail.data
 const mutation=useSafeMutation(),base='/'+kind,backTo=base+(params.size?'?'+params:'')
 function changeFilter(name:string,value:string){const next=new URLSearchParams(params);next.delete('page');if(value)next.set(name,value);else next.delete(name);setParams(next)}
 function propose(path:`/${string}`,method:'POST'|'PATCH',body:Record<string,unknown>,label:string,resultKind:DocKind=kind,sale=false,summary?:ReactNode){
  if(!canWrite||mutation.blocked)return
  const expectedFolio=typeof body.folio==='string'?body.folio:doc?.folio
  mutation.propose({path,method,body,label,review:<><p>{doc?.folio??expectedFolio} · {doc?.sucursal.nombre??'Documento nuevo'}{doc?' · Estado actual: '+doc.estado:''}</p><p>{method==='PATCH'?'Se actualizarán los campos revisados; el servidor recalcula importes cuando corresponde.':sale?'Se creará una venta y se actualizarán existencias, pagos y auditoría según el backend.':'Se registrará la operación y su auditoría. Los cambios de estado y borradores no mueven inventario.'}</p>{typeof body.folio==='string'&&<p>Folio de destino: <strong>{body.folio}</strong></p>}{summary}<p>Sin reenvío automático si la respuesta es incierta.</p></>,
   check:value=>{
    if(sale){const row=record(value),source=kind==='sales-orders'?'orden_venta_id':'pedido_cliente_id';identifier(row.id);if(row.folio!==expectedFolio||row.estado!=='COMPLETADA'||row[source]!==documentId||!doc||(['subtotal','descuento','impuesto','total']as const).some(key=>decimal(String(row[key]),2)!==doc[key]))throw new Error('La venta no corresponde al documento o total esperado.');return row}
    const parsed=parseDocument(value,resultKind,company)
    if(parsed.folio!==expectedFolio||resultKind===kind&&documentId!=='new'&&parsed.id!==documentId||resultKind!==kind&&parsed.cotizacion_id!==documentId)throw new Error('La respuesta no corresponde a la operación enviada.')
    const action=path.split('/').at(-1)??'',targets:Record<string,string>={send:'ENVIADA',accept:'ACEPTADA',reject:'RECHAZADA',expire:'VENCIDA',start:'EN_PROCESO',confirm:'CONFIRMADO',prepare:'EN_PREPARACION',deliver:'ENTREGADO',ready:kind==='sales-orders'?'LISTA':'LISTO',cancel:kind==='customer-orders'?'CANCELADO':'CANCELADA'}
    const expectedState=resultKind!==kind||documentId==='new'?docConfig[resultKind].initial:targets[action]??doc?.estado
    if(parsed.estado!==expectedState||parsed.sucursal_id!==(body.sucursal_id??doc?.sucursal_id)||body.cliente_id!==undefined&&parsed.cliente_id!==body.cliente_id)throw new Error('La respuesta no conserva estado, sucursal o cliente esperado.')
    if(Array.isArray(body.detalles)){const sent=body.detalles.map(record);if(parsed.lines.length!==sent.length||sent.some(line=>!parsed.lines.some(row=>row.producto_id===line.producto_id&&row.cantidad===decimal(String(line.cantidad),3)&&row.descuento_porcentaje===decimal(String(line.descuento_porcentaje),4))))throw new Error('Las partidas confirmadas no coinciden con la solicitud.')}
    if(resultKind!==kind&&doc&&(['subtotal','descuento','impuesto','total']as const).some(key=>parsed[key]!==doc[key]))throw new Error('La conversión no conserva los importes históricos.')
    return parsed
   },success:value=>{const result=record(value);setNotice(label+' · Resultado confirmado: '+String(result.folio));setRevision(x=>x+1);setMode('view');navigate(sale?'/sales/'+result.id:'/'+resultKind+'/'+result.id)}})
 }
 return <section className="commercial-page"><header className="sales-heading"><div><p className="sales-eyebrow">DOCUMENTOS COMERCIALES</p><h1>{config.title}</h1><p>Captura, seguimiento y conversión conforme al estado del documento.</p></div>{!documentId&&canWrite&&<Link className="sales-button" to={base+'/new'}>Crear {config.singular}</Link>}</header>
 {!allowed?<p role="alert">No tienes permiso para consultar {config.title.toLowerCase()}.</p>:<>
  {notice&&<p role="status" className="commercial-notice">{notice}</p>}{mutation.gate}
  {documentId&&<Link to={backTo} className="sales-button sales-button--secondary">Volver al listado</Link>}
  {documentId==='new'?(canWrite?<DocumentEditor kind={kind} disabled={mutation.blocked} onCancel={()=>navigate(base)} onReview={(body,summary)=>propose(`/${kind}`,'POST',body,'Confirmar creación de '+config.singular,kind,false,summary)}/>:<p role="alert">No tienes permiso para crear documentos.</p>):documentId?<>
   {!validId?<p role="alert">Identificador de documento inválido.</p>:<><QueryFeedback resource={detail}/><button type="button" className="sales-button sales-button--secondary" onClick={()=>setRevision(x=>x+1)}>Actualizar documento</button>
    {doc&&<><section className="commercial-panel"><h2>{doc.folio} <span className="sales-badge">{doc.estado}</span></h2><p>{doc.sucursal.nombre} · {doc.cliente?.nombre??'Sin cliente'} · {formatSaleDate(doc.fecha)} UTC</p>{doc.date&&<p>{config.date}: {doc.date}</p>}{doc.referencia_cliente&&<p>Referencia: {doc.referencia_cliente}</p>}{doc.observaciones&&<p>{doc.observaciones}</p>}{doc.cotizacion_id&&<p>Cotización de origen: <Link to={'/quotes/'+doc.cotizacion_id}>Consultar cotización</Link></p>}
     <dl className="purchase-totals">{(['subtotal','descuento','impuesto','total'] as const).map(key=><Fragment key={key}><dt>{{subtotal:'Subtotal',descuento:'Descuento',impuesto:'Impuesto',total:'Total'}[key]}</dt><dd>{formatSaleAmount(Number(doc[key]))}</dd></Fragment>)}</dl>
     {canWrite&&<div className="commercial-actions"><button type="button" className="sales-button sales-button--secondary" disabled={mutation.blocked||doc.estado!==config.initial} onClick={()=>setMode('edit')}>Editar documento</button>{documentActions(kind,doc.estado).map(([action,label])=><button key={action} type="button" className="sales-button sales-button--secondary" disabled={mutation.blocked} onClick={()=>propose(`/${kind}/${doc.id}/${action}`,'POST',{},label)}>{label}</button>)}
      {(kind==='quotes'?doc.estado==='ACEPTADA'&&canOrder:canSell&&doc.estado===(kind==='sales-orders'?'LISTA':'LISTO'))&&<button type="button" className="sales-button" disabled={mutation.blocked} onClick={()=>setMode('convert')}>{kind==='quotes'?'Convertir a orden':'Convertir a venta'}</button>}</div>}
     {(doc.estado==='LISTA'||doc.estado==='LISTO')&&<p className="sales-muted">La API impide una segunda conversión si ya existe venta asociada, incluso si fue cancelada. Su estado operativo puede permanecer sin cambios.</p>}
     <div className="sales-table-scroll"><table className="sales-table"><caption>Partidas confirmadas</caption><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio histórico</th><th>Descuento / impuesto</th><th>Total</th></tr></thead><tbody>{doc.lines.map(row=><tr key={row.id}><td>{row.producto.nombre}<small>{row.producto.sku} · {row.descripcion}</small></td><td>{row.cantidad}</td><td>{row.precio_unitario}</td><td>{row.descuento_porcentaje}% / {row.tasa_impuesto}%</td><td>{row.total_linea}</td></tr>)}</tbody></table></div>
    </section>
    {mode==='edit'&&canWrite&&doc.estado===config.initial&&<DocumentEditor key={doc.id+':'+revision} kind={kind} document={doc} disabled={mutation.blocked} onCancel={()=>setMode('view')} onReview={(body,summary)=>propose(`/${kind}/${doc.id}`,'PATCH',body,'Confirmar edición de '+config.singular,kind,false,summary)}/>}
    {mode==='convert'&&canWrite&&(kind==='quotes'?canOrder:canSell)&&<DocumentConversion document={doc} toOrder={kind==='quotes'} disabled={mutation.blocked} onCancel={()=>setMode('view')} onReview={(body,summary)=>propose(`/${kind}/${doc.id}/${kind==='quotes'?'convert-to-order':'convert-to-sale'}`,'POST',body,'Confirmar conversión',kind==='quotes'?'sales-orders':kind,kind!=='quotes',summary)}/>}
    </>}
   </>}
  </>:<>
   <form className="commercial-panel workflow-filters" onSubmit={e=>{e.preventDefault();changeFilter('q',query.trim())}}><label>Folio del documento a buscar<input maxLength={50} value={query} onChange={e=>setQuery(e.target.value)}/></label><label>Estado del documento<select value={state} onChange={e=>changeFilter('estado',e.target.value)}><option value="">Todos</option>{config.states.map(value=><option key={value}>{value}</option>)}</select></label><button type="submit" className="sales-button">Buscar documentos</button><button type="button" className="sales-button sales-button--secondary" onClick={()=>{setParams({});setQuery('')}}>Restablecer documentos</button><button type="button" className="sales-button sales-button--secondary" onClick={()=>setRevision(x=>x+1)}>Actualizar listado</button></form>
   {!validPage||!validState||!validQuery?<p role="alert">Filtros o página no válidos.</p>:<><QueryFeedback resource={list}/>{list.data&&<section className="commercial-panel"><h2>Documentos registrados</h2><div className="sales-table-scroll"><table className="sales-table"><thead><tr><th>Folio / fecha UTC</th><th>Cliente / sucursal</th><th>Estado</th><th>Total</th><th>Detalle</th></tr></thead><tbody>{list.data.items.map(row=><tr key={row.id}><td>{row.folio}<small>{formatSaleDate(row.fecha)}</small></td><td>{row.cliente?.nombre??'Sin cliente'}<small>{row.sucursal.nombre}</small></td><td>{row.estado}</td><td>{row.total}</td><td><Link to={base+'/'+row.id+(params.size?'?'+params:'')}>Ver documento {row.folio}</Link></td></tr>)}</tbody></table></div>{!list.data.items.length&&<p role="status">No se encontraron documentos.</p>}<Pagination {...list.data} onChange={value=>{const next=new URLSearchParams(params);next.set('page',String(value));setParams(next)}}/></section>}</>}
  </>}
 </>}
 </section>
}
