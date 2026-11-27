import { useState } from 'react'
import type { FormEvent } from 'react'
import type { SalesFilterValues, SalesQuery } from './sales.types'
import { validateSalesFilters } from './sales.query'

interface Props { query: SalesQuery; onApply: (filters: SalesFilterValues) => void; onClear: () => void }
export default function SalesFilters({ query, onApply, onClear }: Props) {
  const [values, setValues] = useState<SalesFilterValues>({
    folio: query.folio, fecha_desde: query.fecha_desde, fecha_hasta: query.fecha_hasta,
    estado: query.estado, condicion_pago: query.condicion_pago,
  })
  const [error, setError] = useState<string | null>(null)
  function update(key: keyof SalesFilterValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }))
    setError(null)
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = { ...values, folio: values.folio.trim() }
    const message = validateSalesFilters(next)
    setError(message)
    if (!message) onApply(next)
  }
  return (
    <form className="sales-filters" onSubmit={submit} aria-label="Filtros de ventas">
      <div className="sales-field sales-field--folio">
        <label htmlFor="sales-folio">Buscar por folio</label>
        <input id="sales-folio" type="search" maxLength={50} value={values.folio}
          placeholder="Escribe todo o parte del folio" onChange={(event) => update('folio', event.target.value)} />
      </div>
      <div className="sales-field">
        <label htmlFor="sales-from">Desde</label>
        <input id="sales-from" type="date" value={values.fecha_desde}
          onChange={(event) => update('fecha_desde', event.target.value)} />
      </div>
      <div className="sales-field">
        <label htmlFor="sales-to">Hasta</label>
        <input id="sales-to" type="date" value={values.fecha_hasta}
          onChange={(event) => update('fecha_hasta', event.target.value)} />
      </div>
      <div className="sales-field">
        <label htmlFor="sales-state">Estado</label>
        <select id="sales-state" value={values.estado} onChange={(event) => update('estado', event.target.value)}>
          <option value="">Todos los estados</option>
          <option value="COMPLETADA">Completadas</option><option value="CANCELADA">Canceladas</option>
        </select>
      </div>
      <div className="sales-field">
        <label htmlFor="sales-payment">Condición de pago</label>
        <select id="sales-payment" value={values.condicion_pago} onChange={(event) => update('condicion_pago', event.target.value)}>
          <option value="">Todas</option><option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option>
        </select>
      </div>
      <div className="sales-filter-actions">
        <button className="sales-button" type="submit">Buscar ventas</button>
        <button className="sales-button sales-button--secondary" type="button" onClick={onClear}>Limpiar</button>
      </div>
      <p className="sales-filter-note">Fechas y horas de la consulta en UTC.</p>
      {error && <p className="sales-error" role="alert">{error}</p>}
    </form>
  )
}
