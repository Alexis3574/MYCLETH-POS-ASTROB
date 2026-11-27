import { useEffect,useRef,useState } from 'react'
import { ApiHttpError } from '../../services/api'
import { clearAuthSession,getAuthSession } from '../auth/auth.session'
import { useAuthSession } from '../auth/useAuthSession'
import { clearInventoryAttempt,normalizeInventoryAction,readInventoryAttempt,saveInventoryAttempt } from './inventory.logic'
import { inventoryService } from './inventory.service'
import type { InventoryAction,InventoryAttempt,InventoryResult } from './inventory.types'
export function useInventoryMutation(onChanged:(result:InventoryResult)=>void) {
  const auth=useAuthSession(),[pending,setPending]=useState(()=>readInventoryAttempt(window.sessionStorage)),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const lock=useRef(pending!==null),sending=useRef(false),active=useRef(true)
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
  const own=!!auth&&!!pending&&pending!=='unreadable'&&pending.companyId===auth.user.empresa.id&&pending.userId===auth.user.id
  async function send(attempt:InventoryAttempt) {
    if(!auth||!active.current||sending.current||getAuthSession()?.accessToken!==auth.accessToken)return
    const permission=attempt.action.kind==='adjust'?'INVENTARIO.AJUSTAR':'INVENTARIO.TRANSFERIR'
    if(!auth.user.permisos.some(item=>item.codigo===permission)){setError('No tienes permiso para esta operación.');return}
    sending.current=true;setBusy(true);setError('')
    try {const result=await inventoryService.run(auth.accessToken,attempt)
      if(!active.current||getAuthSession()?.accessToken!==auth.accessToken)return
      clearInventoryAttempt(window.sessionStorage);setPending(null);lock.current=false;onChanged(result)
    } catch(cause) {
      if(!active.current||getAuthSession()?.accessToken!==auth.accessToken)return
      if(cause instanceof ApiHttpError&&cause.status<500&&![408,409].includes(cause.status)){try{clearInventoryAttempt(window.sessionStorage);setPending(null);lock.current=false}catch{/* Conservar protección. */}}
      if(cause instanceof ApiHttpError&&cause.status===401)clearAuthSession()
      setError(cause instanceof Error?cause.message:'No se pudo confirmar la operación de inventario.')
    } finally{sending.current=false;setBusy(false)}
  }
  function run(action:InventoryAction) {
    if(lock.current||!auth||getAuthSession()?.accessToken!==auth.accessToken)return
    const stored=readInventoryAttempt(window.sessionStorage)
    if(stored){setPending(stored);lock.current=true;return}
    try{const attempt={companyId:auth.user.empresa.id,userId:auth.user.id,key:crypto.randomUUID(),action:normalizeInventoryAction(action)};saveInventoryAttempt(window.sessionStorage,attempt);lock.current=true;setPending(attempt);void send(attempt)}catch(cause){setError(cause instanceof Error?cause.message:'No se pudo proteger el intento antes de enviarlo.')}
  }
  function retry(){if(pending&&pending!=='unreadable'&&!busy&&own)void send(pending)}
  function release(){clearInventoryAttempt(window.sessionStorage);setPending(null);lock.current=false;setError('')}
  return {pending,busy,error,own,run,retry,release}
}
