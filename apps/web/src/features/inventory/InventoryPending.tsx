import { useState } from 'react'
import type { useInventoryMutation } from './useInventoryMutation'
export default function InventoryPending({mutation}:{mutation:ReturnType<typeof useInventoryMutation>}) {
  const [reviewed,setReviewed]=useState(false),[error,setError]=useState('')
  return <section className="commercial-panel inventory-pending" aria-label="Operación de inventario pendiente"><h2>{mutation.busy?'Procesando inventario…':'Revisa el intento de inventario anterior'}</h2><p role={mutation.busy?'status':'alert'}>{mutation.error||'Nuevas operaciones bloqueadas hasta confirmar el resultado.'}</p>
    {mutation.own&&<><p>El reintento conserva la misma clave y los mismos datos. Devuelve el resultado anterior si ya se registró o puede completar la operación si la primera solicitud no llegó. No se reenvía automáticamente.</p><button type="button" className="sales-button" disabled={mutation.busy} onClick={mutation.retry}>Confirmar reintento de inventario</button></>}
    {!mutation.own&&mutation.pending!=='unreadable'&&<p>Inicia sesión con el usuario del intento para recuperarlo.</p>}
    {(mutation.own||mutation.pending==='unreadable')&&<><p>Una consulta sin resultados no demuestra que el envío anterior haya terminado. Libera esta protección solo después de comprobar el resultado.</p><label className="commercial-check"><input type="checkbox" disabled={mutation.busy} checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/>He revisado el resultado y puedo continuar sin duplicarlo.</label>{error&&<p role="alert">{error}</p>}<button type="button" className="sales-button sales-button--secondary" disabled={!reviewed||mutation.busy} onClick={()=>{try{mutation.release()}catch{setError('No se pudo liberar la protección de esta pestaña.')}}}>Habilitar inventario después de revisar</button></>}
  </section>
}
