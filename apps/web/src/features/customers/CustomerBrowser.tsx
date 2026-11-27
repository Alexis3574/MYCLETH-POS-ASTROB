import { useState } from 'react'
import { useCustomers, usePermission } from '../commercial/commercial.hooks'
import type { Customer } from '../commercial/commercial.types'
import Pagination from '../commercial/Pagination'
import QueryFeedback from '../commercial/QueryFeedback'
import SearchForm from '../commercial/SearchForm'

export default function CustomerBrowser({ onSelect }: { onSelect?: (customer: Customer) => void }) {
  const allowed = usePermission('CLIENTES.VER')
  const [query, setQuery] = useState({ text: '', active: 'true', page: 1 })
  const resource = useCustomers(query.text, query.active, query.page, allowed)
  if (!allowed) return <p role="alert">No tienes permiso para consultar clientes. Puedes preparar una venta de contado sin cliente.</p>
  return <div className="commercial-panel">
    <h2>Clientes</h2>
    <SearchForm label="Nombre, código, RFC, correo o teléfono" onlyActive={!!onSelect} onSearch={(text, active) => setQuery({ text, active, page: 1 })} />
    <QueryFeedback resource={resource} />
    {resource.data && <>
      <div className="sales-table-scroll" role="region" aria-label="Clientes encontrados" tabIndex={0}>
        <table className="sales-table"><thead><tr><th>Cliente</th><th>Contacto</th><th>Crédito configurado</th><th>Estado</th>{onSelect && <th>Acción</th>}</tr></thead>
          <tbody>{resource.data.items.map((item) => <tr key={item.id}>
            <td><strong>{item.nombre}</strong><small>{item.codigo} · {item.rfc ?? 'Sin RFC'}</small></td>
            <td>{item.email ?? 'Sin correo'}<small>{item.telefono ?? 'Sin teléfono'}</small></td>
            <td>{item.limite_credito}<small>{item.dias_credito} días · El límite no representa saldo disponible.</small></td>
            <td>{item.activo ? 'Activo' : 'Inactivo'}</td>
            {onSelect && <td><button type="button" className="sales-button sales-button--secondary" disabled={!item.activo} onClick={() => onSelect(item)}>Seleccionar<span className="sales-sr-only"> a {item.nombre}</span></button></td>}
          </tr>)}</tbody></table>
      </div>
      {!resource.data.items.length && <p role="status" className="commercial-notice">No se encontraron clientes.</p>}
      <Pagination {...resource.data} onChange={(page) => setQuery({ ...query, page })} />
    </>}
  </div>
}
