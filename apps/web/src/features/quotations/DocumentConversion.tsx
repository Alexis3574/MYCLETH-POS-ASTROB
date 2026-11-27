import { useState } from 'react'
import type { ReactNode } from 'react'
import WarehousePicker from '../commercial/WarehousePicker'
import CashSessionPicker from '../cash/CashSessionPicker'
import type { CashChoice } from '../cash/CashSessionPicker'
import { useMethods } from '../commercial/commercial.hooks'
import type { Warehouse } from '../commercial/commercial.types'
import QueryFeedback from '../commercial/QueryFeedback'
import Pagination from '../commercial/Pagination'
import { decimal, scaled } from '../purchases/purchase.logic'
import { calendar, folio } from './document.logic'
import type { Document } from './document.logic'
import { useAuthSession } from '../auth/useAuthSession'
export default function DocumentConversion({document,toOrder,disabled,onReview,onCancel}:{document:Document;toOrder:boolean;disabled:boolean;onReview:(body:Record<string,unknown>,summary:ReactNode)=>void;onCancel:()=>void}){
 const auth=useAuthSession()!,[number,setNumber]=useState(''),[notes,setNotes]=useState(document.observaciones??''),[date,setDate]=useState(''),[warehouse,setWarehouse]=useState<Warehouse|null>(null),[cash,setCash]=useState<CashChoice|null>(null),[error,setError]=useState('')
 const [payments,setPayments]=useState([{method:'',amount:document.total,reference:''}]),[page,setPage]=useState(1),methods=useMethods(page,!toOrder)
 const [selectedMethods,setSelectedMethods]=useState<NonNullable<typeof methods.data>['items']>([])
 const allMethods=[...(methods.data?.items??[]),...selectedMethods.filter(row=>!methods.data?.items.some(item=>item.id===row.id))]
 const hasCash=payments.some(row=>allMethods.some(item=>item.id===row.method&&item.es_efectivo))
 function review(){try{
  const body:Record<string,unknown>={folio:folio(number),observaciones:notes.trim()||null}
  if(notes.trim().length>2000)throw new Error('Observaciones demasiado extensas.')
  if(toOrder)body.fecha_compromiso=calendar(date)
  else{
    if(!warehouse?.activo||!warehouse.sucursal.activo||warehouse.sucursal.id!==document.sucursal_id||warehouse.sucursal.empresa_id!==auth.user.empresa.id)throw new Error('Selecciona un almacén activo de la misma sucursal del documento.')
    let total=0n
    const rows=payments.map(row=>{const method=allMethods.find(item=>item.id===row.method&&item.activo);if(!method)throw new Error('Selecciona métodos activos.');if(method.codigo==='CREDITO'&&!document.cliente_id)throw new Error('El crédito requiere cliente en el documento original.');const value=decimal(row.amount,2,true);total+=scaled(value,2);if(row.reference.trim().length>150)throw new Error('Referencia demasiado extensa.');return{metodo_pago_id:method.id,monto:value,referencia:row.reference.trim()||null}})
    if(total!==scaled(document.total,2))throw new Error('Los pagos deben cubrir exactamente el total histórico '+document.total)
    if(hasCash&&(!cash||cash.session.estado!=='ABIERTA'||cash.session.fecha_cierre!==null||cash.session.usuario_apertura_id!==auth.user.id||cash.register.sucursal_id!==document.sucursal_id))throw new Error('El efectivo requiere una sesión propia abierta en la sucursal del documento.')
    body.almacen_id=warehouse.id;body.pagos=rows;body.sesion_caja_id=hasCash?cash!.session.id:null
  }
  onReview(body,<><p>Origen: {document.folio} · Cliente: {document.cliente?.nombre??'Sin cliente'} · Total histórico: <strong>{document.total}</strong></p><ul>{document.lines.map(line=><li key={line.id}>{line.producto.nombre}: {line.cantidad} · Total {line.total_linea}</li>)}</ul>{toOrder?<p>Fecha compromiso: {date||'Sin fecha'}. Crear la orden no mueve inventario.</p>:<><p>Destino: {warehouse?.sucursal.nombre} / {warehouse?.nombre}</p><ul>{payments.map((row,index)=><li key={index}>{allMethods.find(item=>item.id===row.method)?.nombre}: {decimal(row.amount,2)} · {row.reference||'Sin referencia'}</li>)}</ul>{hasCash&&<p>Caja: {cash?.register.nombre} · Sesión {cash?.session.id}</p>}</>}{notes&&<p>Observaciones: {notes}</p>}</>);setError('')
 }catch(cause){setError(cause instanceof Error?cause.message:'Revisa los datos.')}}
 return <section className="commercial-panel"><h2>{toOrder?'Convertir cotización en orden':'Convertir documento en venta'}</h2><p>{document.folio} · Total histórico {document.total} · {document.sucursal.nombre}</p><fieldset disabled={disabled} className="workflow-fields"><legend>Datos de conversión</legend>
  <label>Folio de destino<input maxLength={50} value={number} onChange={e=>setNumber(e.target.value)}/></label><label>Observaciones de conversión<textarea maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
  {toOrder?<label>Fecha compromiso de la orden<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>:<><WarehousePicker value={warehouse} onChange={value=>{setWarehouse(value);setCash(null)}}/><QueryFeedback resource={methods}/>
   {payments.map((row,index)=><div className="workflow-line" key={index}><label>Método de conversión {index+1}<select value={row.method} onChange={e=>{const method=allMethods.find(item=>item.id===e.target.value);if(method)setSelectedMethods(values=>values.some(item=>item.id===method.id)?values:[...values,method]);setPayments(payments.map((item,i)=>i===index?{...item,method:e.target.value}:item));setCash(null)}}><option value="">Selecciona un método</option>{allMethods.map(item=><option key={item.id} value={item.id} disabled={!item.activo}>{item.nombre}</option>)}</select></label><label>Importe de conversión {index+1}<input inputMode="decimal" value={row.amount} onChange={e=>setPayments(payments.map((item,i)=>i===index?{...item,amount:e.target.value}:item))}/></label><label>Referencia de conversión {index+1}<input maxLength={150} value={row.reference} onChange={e=>setPayments(payments.map((item,i)=>i===index?{...item,reference:e.target.value}:item))}/></label>{payments.length>1&&<button type="button" className="sales-button sales-button--secondary" onClick={()=>setPayments(payments.filter((_,i)=>i!==index))}>Quitar pago de conversión {index+1}</button>}</div>)}
   {methods.data&&methods.data.total>methods.data.size&&<Pagination {...methods.data} onChange={setPage}/>}
   <button type="button" className="sales-button sales-button--secondary" disabled={payments.length>=20} onClick={()=>setPayments([...payments,{method:'',amount:'',reference:''}])}>Agregar pago de conversión</button>
   {hasCash&&<CashSessionPicker branchId={document.sucursal_id} onSelect={setCash}/>}
   <p className="sales-muted">Se crea una venta con los precios e impuestos históricos del documento. El backend verifica existencias, pagos y la ausencia de una venta asociada. La orden o pedido conserva su estado operativo; no se simula facturación fiscal.</p>
  </>}
  {error&&<p role="alert" className="sales-error">{error}</p>}<div className="commercial-actions"><button type="button" className="sales-button sales-button--secondary" onClick={onCancel}>Volver al documento</button><button type="button" className="sales-button" onClick={review}>Revisar conversión</button></div>
 </fieldset></section>
}
