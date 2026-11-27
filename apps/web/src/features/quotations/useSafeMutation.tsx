import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { apiRequest, ApiHttpError } from '../../services/api'
import { getAuthSession, clearAuthSession } from '../auth/auth.session'
import { useAuthSession } from '../auth/useAuthSession'
import { record } from './document.logic'
export interface MutationProposal { path:`/${string}`; method:'POST'|'PATCH'|'DELETE'; body?:unknown; label:string; review:ReactNode; check:(data:unknown)=>unknown; success:(result:unknown)=>void }
interface Guard { company:string; user:string; marker:string; label:string; path:string }
const storageKey='posmycleth.workflow.pending.v1'
function readGuard():Guard|'unreadable'|null {
  try{const raw=sessionStorage.getItem(storageKey);if(!raw)return null;const value=record(JSON.parse(raw));if(!['company','user','marker','label','path'].every(key=>typeof value[key]==='string'))return'unreadable';return value as unknown as Guard}catch{return'unreadable'}
}
export function useSafeMutation(){
  const session=useAuthSession()!,[pending,setPending]=useState(readGuard),[proposal,setProposal]=useState<MutationProposal|null>(null),[error,setError]=useState(''),[running,setRunning]=useState(false),[reviewed,setReviewed]=useState(false),lock=useRef(false)
  const active=useRef(true)
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
  const identity=()=>active.current&&getAuthSession()?.accessToken===session.accessToken
  function propose(value:MutationProposal){const existing=readGuard();if(existing){setPending(existing);return}setError('');setProposal(value)}
  async function confirm(){
    if(!proposal||lock.current||!identity())return
    const existing=readGuard();if(existing){setPending(existing);return}
    const guard:Guard={company:session.user.empresa.id,user:session.user.id,marker:crypto.randomUUID(),label:proposal.label,path:proposal.path}
    try{sessionStorage.setItem(storageKey,JSON.stringify(guard))}catch{setError('No se pudo guardar la protección del intento. No se envió la operación.');return}
    lock.current=true;setRunning(true);setPending(guard)
    try{
      const response=record(await apiRequest(proposal.path,{token:session.accessToken,method:proposal.method,body:proposal.body}))
      if(response.ok!==true)throw new Error('La API no confirmó el resultado.')
      const result=proposal.check(response.data)
      if(!identity())return
      sessionStorage.removeItem(storageKey);setPending(null);setProposal(null);proposal.success(result)
    }catch(cause){
      if(!identity())return
      const rejected=cause instanceof ApiHttpError&&cause.status>=400&&cause.status<500&&![408,409].includes(cause.status)
      if(rejected){try{sessionStorage.removeItem(storageKey);setPending(null)}catch{setError('La solicitud fue rechazada, pero no se pudo liberar su protección local. Revisa el resultado antes de continuar.');return}if(cause.status===401)clearAuthSession()}
      setError(cause instanceof Error?cause.message:'Resultado incierto. Consulta el estado antes de continuar.')
    }finally{lock.current=false;if(active.current){setRunning(false);setProposal(null)}}
  }
  const owned=pending!=='unreadable'&&pending?.company===session.user.empresa.id&&pending?.user===session.user.id
  const gate=pending?<section className="commercial-panel" aria-label="Revisión de operación pendiente"><h2>{running?'Procesando operación':'Revisar resultado anterior'}</h2><p>{pending==='unreadable'?'La protección local no se puede interpretar.':pending.label}</p><p>Consulta el documento, folio o asignación antes de continuar. Estas rutas no ofrecen un reintento idempotente general; no se reenviará la operación automáticamente.</p>{error&&<p role="alert">{error}</p>}
    <div className="commercial-actions"><Link to="/quotes">Cotizaciones</Link><Link to="/sales-orders">Órdenes</Link><Link to="/customer-orders">Pedidos</Link><Link to="/sales">Ventas</Link><Link to="/users">Usuarios</Link><Link to="/roles">Roles</Link></div>
    {!running&&(owned||pending==='unreadable')?<><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> Comprobé el resultado con una persona autorizada y evitaré repetirlo.</label><button type="button" className="sales-button" disabled={!reviewed} onClick={()=>{try{sessionStorage.removeItem(storageKey);setPending(null);setProposal(null);setReviewed(false);setError('')}catch{setError('No se pudo liberar la protección local.')}}}>Continuar después de revisar</button><p className="sales-muted">Liberar esta protección no demuestra que la solicitud anterior haya terminado.</p></>:!running&&<p role="alert">La operación pertenece a otra identidad; debe revisarla su responsable.</p>}</section>
    :proposal?<section className="commercial-panel" aria-label="Confirmación de operación"><h2>{proposal.label}</h2>{proposal.review}{error&&<p role="alert">{error}</p>}<div className="commercial-actions"><button type="button" className="sales-button sales-button--secondary" onClick={()=>{setProposal(null);setError('')}}>Volver sin registrar</button><button type="button" className="sales-button" onClick={confirm}>Confirmar operación</button></div></section>:null
  return{propose,gate,error,blocked:!!pending||!!proposal}
}
