import { useState } from 'react'
import type { ReactNode } from 'react'
import ProductBrowser from '../products/ProductBrowser'
import CustomerBrowser from '../customers/CustomerBrowser'
import WarehousePicker from '../commercial/WarehousePicker'
import { usePermission } from '../commercial/commercial.hooks'
import { useAuthSession } from '../auth/useAuthSession'
import type { Product, Customer, Warehouse } from '../commercial/commercial.types'
import { calendar, docConfig, folio, normalizeLines, text } from './document.logic'
import type { DocKind, Document } from './document.logic'
import { decimal, estimatePurchase, scaled } from '../purchases/purchase.logic'
interface Line { producto_id:string; sku:string; nombre:string; cantidad:string; descuento_porcentaje:string; descripcion:string; price:string; tax:string; fractional?:boolean }
export default function DocumentEditor({kind,document,onReview,disabled,onCancel}:{kind:DocKind;document?:Document;onReview:(body:Record<string,unknown>,summary:ReactNode)=>void;disabled:boolean;onCancel:()=>void}){
 const auth=useAuthSession()!,config=docConfig[kind],canProducts=usePermission('PRODUCTOS.VER'),locked=!!document?.cotizacion_id
 const [warehouse,setWarehouse]=useState<Warehouse|null>(null),[client,setClient]=useState<Customer|Document['cliente']>(document?.cliente??null),[choosing,setChoosing]=useState(false)
 const [number,setNumber]=useState(document?.folio??''),[date,setDate]=useState(document?.date??''),[notes,setNotes]=useState(document?.observaciones??''),[reference,setReference]=useState(document?.referencia_cliente??''),[error,setError]=useState('')
 const [lines,setLines]=useState<Line[]>(()=>document?.lines.map(row=>({producto_id:row.producto_id,sku:row.producto.sku,nombre:row.producto.nombre,cantidad:row.cantidad,descuento_porcentaje:row.descuento_porcentaje,descripcion:row.descripcion??'',price:row.precio_unitario,tax:row.tasa_impuesto}))??[])
 function add(product:Product){
   try{
    if(product.empresa_id!==auth.user.empresa.id||!product.activo||!product.unidad_medida.activo)throw new Error('Producto no disponible en esta empresa.')
    if(lines.some(row=>row.producto_id===product.id)){setError('El producto ya está agregado; modifica su cantidad.');return}
    const tax=product.impuestos.filter(row=>row.activo).reduce((sum,row)=>sum+scaled(decimal(String(row.tasa),4),4),0n)
    if(tax>1000000n)throw new Error('La suma de impuestos supera 100%.')
    setLines([...lines,{producto_id:product.id,sku:product.sku,nombre:product.nombre,cantidad:'1',descuento_porcentaje:'0',descripcion:product.nombre,price:decimal(product.precio_venta,4),tax:(Number(tax)/10000).toFixed(4),fractional:product.unidad_medida.permite_decimales}]);setError('')
   }catch(cause){setError(cause instanceof Error?cause.message:'Revisa el producto.')}
 }
 function review(){try{
   if(!document&&(!warehouse?.activo||!warehouse.sucursal.activo||warehouse.sucursal.empresa_id!==auth.user.empresa.id))throw new Error('Selecciona una sucursal autorizada mediante su almacén.')
   if(kind==='customer-orders'&&!client)throw new Error('El pedido requiere cliente.')
   const body:Record<string,unknown>={observaciones:text(notes,2000,true)||null,[config.date]:calendar(date)}
   if(!locked){const details=normalizeLines(lines.map(row=>({...row,descripcion:row.descripcion||null})));for(const[rowIndex,row]of lines.entries())if(row.fractional===false&&scaled(details[rowIndex].cantidad,3)%1000n)throw new Error('La unidad de '+row.sku+' exige cantidad entera.');estimatePurchase(lines.map(row=>({producto_id:row.producto_id,descripcion:row.descripcion||null,cantidad:row.cantidad,precio_unitario:row.price,descuento_porcentaje:row.descuento_porcentaje,tasa_impuesto:row.tax})));body.cliente_id=client?.id??null;body.detalles=details}
   if(kind==='customer-orders')body.referencia_cliente=text(reference,100,true)||null
   if(!document){body.sucursal_id=warehouse!.sucursal.id;body.folio=folio(number)}
   const estimate=estimatePurchase(lines.map(row=>({producto_id:row.producto_id,descripcion:row.descripcion||null,cantidad:row.cantidad,precio_unitario:row.price,descuento_porcentaje:row.descuento_porcentaje,tasa_impuesto:row.tax})))
   onReview(body,<><p>Sucursal: {document?.sucursal.nombre??warehouse?.sucursal.nombre} · Cliente: {client?.nombre??'Sin cliente'}</p><p>Fecha: {date||'Sin fecha'} · Total estimado: <strong>{estimate.total}</strong></p><ul>{lines.map(row=><li key={row.producto_id}>{row.nombre} ({row.sku}): {row.cantidad} · Descuento {row.descuento_porcentaje}%</li>)}</ul>{notes&&<p>Observaciones: {notes}</p>}<p>La API confirma los importes definitivos antes de continuar con el documento.</p></>);setError('')
 }catch(cause){setError(cause instanceof Error?cause.message:'Revisa el documento.')}}
 return <section className="commercial-panel"><h2>{document?'Editar '+config.singular:'Crear '+config.singular}</h2>
  <fieldset disabled={disabled} className="workflow-fields"><legend>Datos y partidas</legend>
  {document?<p>Sucursal: {document.sucursal.nombre} · Folio: {document.folio}</p>:<><WarehousePicker value={warehouse} onChange={setWarehouse}/><p className="sales-muted">El almacén selecciona la sucursal. Guardar este documento no mueve ni reserva inventario.</p><label>Folio del documento<input value={number} maxLength={50} onChange={e=>setNumber(e.target.value)}/></label></>}
  <label>{kind==='quotes'?'Válida hasta':kind==='sales-orders'?'Fecha compromiso':'Fecha entrega'}<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
  {kind==='customer-orders'&&<label>Referencia del cliente<input maxLength={100} value={reference} onChange={e=>setReference(e.target.value)}/></label>}
  <label>Observaciones del documento<textarea maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
  <p>Cliente: <strong>{client?.nombre??'Sin cliente'}</strong></p>
  {!locked&&<div className="commercial-actions"><button type="button" className="sales-button sales-button--secondary" onClick={()=>setChoosing(!choosing)}>Seleccionar cliente</button>{kind!=='customer-orders'&&client&&<button type="button" className="sales-button sales-button--secondary" onClick={()=>setClient(null)}>Quitar cliente del documento</button>}</div>}
  {choosing&&!locked&&<CustomerBrowser onSelect={value=>{setClient(value);setChoosing(false)}}/>}
  {locked?<p>Esta orden conserva las partidas y el cliente de su cotización original.</p>:canProducts?<ProductBrowser selecting onSelect={add}/>:<p role="alert">Necesitas PRODUCTOS.VER para capturar partidas.</p>}
  {lines.map((row,index)=><article className="workflow-line" key={row.producto_id}><h3>{row.nombre} · {row.sku}</h3><div className="purchase-fields">{([['cantidad','Cantidad'],['descuento_porcentaje','Descuento %'],['descripcion','Descripción']] as const).map(([field,label])=><label key={field}>{label} · {row.sku}<input disabled={locked} maxLength={field==='descripcion'?250:40} value={row[field]} onChange={e=>setLines(lines.map((line,i)=>i===index?{...line,[field]:e.target.value}:line))}/></label>)}</div><p>Precio de referencia: {row.price} · Impuesto: {row.tax}%</p>{!locked&&<button type="button" className="sales-button sales-button--secondary" onClick={()=>setLines(lines.filter((_,i)=>i!==index))}>Quitar partida {row.sku}</button>}</article>)}
  <p className="sales-muted">La API recalcula precios e impuestos al guardar o editar. La conversión conserva los importes históricos confirmados. Los productos inventariables requieren cantidades enteras al convertir a venta.</p>
  {error&&<p role="alert" className="sales-error">{error}</p>}<div className="commercial-actions"><button type="button" className="sales-button sales-button--secondary" onClick={onCancel}>Volver al documento</button><button type="button" className="sales-button" onClick={review}>Revisar documento</button></div>
  </fieldset>
 </section>
}
