import { useLayoutEffect, useRef } from 'react'

export default function DiscardConfirmation({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  return <dialog ref={ref} className="pos-confirm" aria-labelledby="pos-discard-title" onCancel={(event) => { event.preventDefault(); onKeep() }}>
    <h2 id="pos-discard-title">¿Descartar esta captura?</h2>
    <p>Se retirarán los artículos, el cliente y los pagos del borrador. No se registrará ninguna venta.</p>
    <div className="commercial-actions">
      <button type="button" className="sales-button sales-button--secondary" autoFocus onClick={onKeep}>Conservar captura</button>
      <button type="button" className="sales-button" onClick={onDiscard}>Sí, descartar captura</button>
    </div>
  </dialog>
}
