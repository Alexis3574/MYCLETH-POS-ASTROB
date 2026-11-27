import { useLayoutEffect, useRef } from 'react'
import type { SaleInput } from '../commercial/commercial.types'
import { formatAmount } from './pos.logic'

export default function SaleConfirmation({ input, total, onCancel, onConfirm }: { input: SaleInput; total: number; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  return <dialog ref={ref} className="pos-confirm" aria-labelledby="pos-confirm-title" onCancel={(event) => { event.preventDefault(); onCancel() }}>
    <h2 id="pos-confirm-title">Confirmar registro de venta</h2><p>Folio: <strong>{input.folio ?? 'Asignación automática al registrar'}</strong></p>
    <p>{input.detalles.length} artículos · Total estimado: <strong>{formatAmount(total)}</strong></p>
    <p>Se verificarán importes, existencias y pagos. Al confirmar se registra la venta y se actualizan inventario y caja cuando corresponda.</p>
    <div className="commercial-actions"><button type="button" className="sales-button sales-button--secondary" autoFocus onClick={onCancel}>Volver a revisar</button>
      <button type="button" className="sales-button" onClick={onConfirm}>Confirmar y registrar venta</button></div>
  </dialog>
}
