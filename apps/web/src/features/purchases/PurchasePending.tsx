import { useState } from 'react'
import type { usePurchaseMutation } from './usePurchaseMutation'
export default function PurchasePending({ mutation }: { mutation: ReturnType<typeof usePurchaseMutation> }) {
  const [reviewed, setReviewed] = useState(false), [releaseError, setReleaseError] = useState('')
  const attempt = mutation.pending
  if (!attempt) return null
  return <section className="commercial-panel" aria-label="Compra pendiente de confirmar"><h2>{mutation.busy ? 'Procesando compra…' : 'Revisa el intento de compra anterior'}</h2>
    <p role={mutation.busy ? 'status' : 'alert'}>{mutation.error || 'La operación permanece protegida hasta confirmar su resultado.'}</p>
    {mutation.own && attempt !== 'unreadable' && <><p>{attempt.action.kind === 'create' ? 'Crear compra ' + attempt.action.body.folio : attempt.action.kind === 'receive' ? 'Recibir compra' : attempt.action.kind === 'pay' ? 'Registrar pago de compra' : 'Cancelar compra'}</p>
      <p>El reintento utiliza la misma clave y los mismos datos. El servidor devuelve el resultado anterior si ya se registró; si la primera solicitud no llegó, puede completar ahora la operación. No se reintenta automáticamente.</p>
      <button type="button" className="sales-button" disabled={mutation.busy} onClick={mutation.retry}>Confirmar reintento con la misma clave</button></>}
    {!mutation.own && attempt !== 'unreadable' && <p>Inicia sesión con el usuario del intento para recuperarlo.</p>}
    {(mutation.own || attempt === 'unreadable') && <><p>Libera la protección solo después de revisar el resultado. Una consulta sin registros no demuestra que la solicitud anterior haya terminado.</p>
      <label className="commercial-check"><input type="checkbox" checked={reviewed} disabled={mutation.busy} onChange={event => setReviewed(event.target.checked)} />He revisado el resultado y puedo continuar sin duplicarlo.</label>
      {releaseError && <p role="alert">{releaseError}</p>}
      <button type="button" className="sales-button sales-button--secondary" disabled={!reviewed || mutation.busy} onClick={() => { try { mutation.release() } catch { setReleaseError('No se pudo liberar la protección de esta pestaña.') } }}>Habilitar compras después de revisar</button></>}
  </section>
}
