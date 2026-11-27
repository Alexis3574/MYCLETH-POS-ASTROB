import { useCallback, useState } from 'react'
import { usePermission } from '../commercial/commercial.hooks'
import { useRemoteResource } from '../../hooks/useRemoteResource'
import { accessService } from '../users/access.service'
import QueryFeedback from '../commercial/QueryFeedback'
export default function PermissionCatalog(){
 const allowed=usePermission('USUARIOS.VER'),[query,setQuery]=useState(''),load=useCallback((token:string,signal:AbortSignal)=>accessService.permissions(token,signal),[]),resource=useRemoteResource('permission-catalog',allowed,load)
 if(!allowed)return <p role="alert">No tienes permiso para consultar permisos.</p>
 const rows=resource.data?.filter(row=>[row.codigo,row.modulo,row.descripcion].some(value=>value?.toLowerCase().includes(query.toLowerCase())))
 return <section className="commercial-panel"><h2>Catálogo de permisos</h2><p>Los códigos están definidos por el backend. Se asignan a roles desde su administración.</p><label>Buscar permiso o módulo<input value={query} onChange={e=>setQuery(e.target.value)}/></label><QueryFeedback resource={resource}/><div className="workflow-permissions">{rows?.map(row=><article key={row.id}><strong>{row.codigo}</strong><p>{row.modulo}</p><p>{row.descripcion??'Sin descripción'}</p></article>)}</div>{rows&&!rows.length&&<p>No hay coincidencias.</p>}</section>
}
