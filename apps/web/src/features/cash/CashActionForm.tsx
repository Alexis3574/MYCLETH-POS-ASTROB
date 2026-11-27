import { useLayoutEffect, useRef, useState } from 'react'
import { cashAmount, cashCents, cashInput, cashMovementInput, cashNotes } from './cash.logic'
import type { CashAction, CashSessionDetail } from './cash.types'
import type { CashRegister } from '../commercial/commercial.types'
import { formatSaleAmount } from '../sales/sales.query'

export default function CashActionForm({ kind, register, session, busy, error, onBack, onConfirm }: {
  kind: CashAction['kind']; register: CashRegister; session: CashSessionDetail | null; busy: boolean; error: string
  onBack: () => void; onConfirm: (action: CashAction) => void
}) {
  const [amount, setAmount] = useState(''), [notes, setNotes] = useState(''), [concept, setConcept] = useState('')
  const [type, setType] = useState('ENTRADA'), [reference, setReference] = useState('')
  const [validation, setValidation] = useState(''), [proposal, setProposal] = useState<CashAction | null>(null)
  const first = useRef<HTMLInputElement>(null), back = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => { if (proposal) back.current?.focus(); else first.current?.focus() }, [proposal])
  const expected = session ? cashCents(session.monto_esperado_actual, true) : 0
  let difference: number | null = null
  try { if (amount.trim()) difference = cashCents(cashInput(amount)) - expected } catch { /* Aún no hay un conteo válido. */ }
  const title = kind === 'open' ? 'Abrir sesión de caja' : kind === 'move' ? 'Registrar movimiento' : 'Arqueo y cierre de caja'
  function review() {
    try {
      if (kind !== 'open' && !session) throw new Error('Consulta la sesión antes de preparar la operación.')
      const action: CashAction = kind === 'open'
        ? { kind, cashId: register.id, previousMaxId: '0', body: { monto_apertura: cashInput(amount), notas: cashNotes(notes) } }
        : kind === 'move'
          ? { kind, cashId: register.id, sessionId: session!.id, body: cashMovementInput(type, amount, concept, reference || crypto.randomUUID()) }
          : { kind, cashId: register.id, sessionId: session!.id, body: { monto_cierre: cashInput(amount), notas: cashNotes(notes) } }
      if (action.kind === 'move' && action.body.tipo === 'SALIDA' && cashCents(action.body.monto) > expected) throw new Error('El retiro supera el efectivo esperado en esta sesión.')
      if (action.kind === 'move') setReference(action.body.referencia)
      setProposal(action); setValidation('')
    } catch (cause) { setValidation(cause instanceof Error ? cause.message : 'Revisa la captura.') }
  }
  if (proposal) return <section className="commercial-panel cash-confirm" aria-label="Confirmación de caja">
    <h2>{kind === 'open' ? 'Confirmar apertura' : kind === 'move' ? 'Confirmar movimiento' : 'Confirmar cierre'}</h2>
    <p>{register.nombre} · {register.codigo}{session ? ' · Sesión ' + session.id : ''}</p>
    <dl className="cash-totals"><dt>{kind === 'open' ? 'Fondo inicial' : kind === 'move' ? (proposal.kind === 'move' && proposal.body.tipo === 'ENTRADA' ? 'Entrada' : 'Salida') : 'Efectivo contado'}</dt>
      <dd>{formatSaleAmount(Number(kind === 'open' && proposal.kind === 'open' ? proposal.body.monto_apertura : proposal.kind === 'move' ? proposal.body.monto : proposal.kind === 'close' ? proposal.body.monto_cierre : 0))}</dd>
      {kind === 'close' && <><dt>Esperado al consultar</dt><dd>{formatSaleAmount(expected / 100)}</dd><dt>Diferencia estimada</dt><dd>{formatSaleAmount((difference ?? 0) / 100)}</dd></>}
    </dl>
    {proposal.kind === 'move' ? <><p>Concepto: {proposal.body.concepto}</p><p>Referencia: {proposal.body.referencia}</p></> : proposal.body.notas && <p>Notas: {proposal.body.notas}</p>}
    <p>{kind === 'close' ? 'El cierre es definitivo para esta sesión y registra el arqueo. El servidor recalcula el efectivo esperado con los movimientos confirmados al cerrar.' : 'Se registrará la operación y su auditoría.'}</p>
    {error && <p role="alert" className="sales-error">{error}</p>}
    <div className="commercial-actions"><button ref={back} type="button" className="sales-button sales-button--secondary" disabled={busy} onClick={() => setProposal(null)}>Volver a editar</button>
      <button type="button" className="sales-button" disabled={busy} onClick={() => onConfirm(proposal)}>{busy ? 'Procesando…' : kind === 'open' ? 'Confirmar apertura' : kind === 'move' ? 'Confirmar movimiento' : 'Confirmar cierre'}</button></div>
  </section>
  return <form className="commercial-panel cash-form" aria-label={title} onSubmit={event => { event.preventDefault(); review() }}>
    <h2>{title}</h2><p>{register.nombre}{session ? ' · Sesión ' + session.id : ''}</p>
    <fieldset disabled={busy} className="pos-fields">
      {kind === 'move' && <label>Tipo de movimiento<select value={type} onChange={event => { setType(event.target.value); setValidation('') }}><option value="ENTRADA">Entrada de efectivo</option><option value="SALIDA">Salida de efectivo</option></select></label>}
      <label>{kind === 'open' ? 'Fondo inicial' : kind === 'move' ? 'Importe del movimiento' : 'Efectivo contado'}<input ref={first} inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setValidation('') }} /></label>
      {kind === 'move' ? <><label>Concepto<input maxLength={180} value={concept} onChange={event => { setConcept(event.target.value); setValidation('') }} /></label>
        <p className="sales-muted">Se asigna una referencia única al revisar el movimiento. Puedes conservar una referencia propia si ya la utilizas.</p>
        <label>Referencia del movimiento (opcional)<input maxLength={105} value={reference} onChange={event => { setReference(event.target.value); setValidation('') }} /></label></>
        : <label>Notas (opcional)<textarea maxLength={1500} value={notes} onChange={event => { setNotes(event.target.value); setValidation('') }} /></label>}
      {kind !== 'open' && <p className="commercial-notice">Efectivo esperado al consultar: <strong>{formatSaleAmount(expected / 100)}</strong>{kind === 'close' && difference !== null ? ' · Diferencia de conteo: ' + cashAmount(difference) : ''}</p>}
      {kind === 'close' && <p className="sales-muted">Cuenta el efectivo físico. Este conteo se guarda al confirmar el cierre; no se guarda como un arqueo independiente.</p>}
      {(validation || error) && <p role="alert" className="sales-error">{validation || error}</p>}
      <div className="commercial-actions"><button type="button" className="sales-button sales-button--secondary" onClick={onBack}>Volver sin registrar</button><button className="sales-button" type="submit">Revisar operación</button></div>
    </fieldset>
  </form>
}
