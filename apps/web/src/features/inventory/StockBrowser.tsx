import { useState } from 'react'
import { usePermission, useStock } from '../commercial/commercial.hooks'
import Pagination from '../commercial/Pagination'
import QueryFeedback from '../commercial/QueryFeedback'
import SearchForm from '../commercial/SearchForm'

export default function StockBrowser({ warehouseId, productId }: { warehouseId: string; productId?: string }) {
  const allowed = usePermission('INVENTARIO.VER')
  const [query, setQuery] = useState({ search: '', page: 1 })
  const resource = useStock(warehouseId, query.search, query.page, allowed, productId)
  return <div className="commercial-panel"><h2>Existencias por almacén</h2>
    {!productId && <SearchForm label="Buscar existencias por nombre, SKU o código" onlyActive onSearch={(search) => setQuery({ search, page: 1 })} />}
    <QueryFeedback resource={resource} />
    {resource.data && <>
      <div className="sales-table-scroll" role="region" aria-label="Existencias del almacén" tabIndex={0}>
        <table className="sales-table"><thead><tr><th>Producto</th><th>Cantidad</th><th>Reservado</th><th>Disponible</th><th>Situación</th></tr></thead>
          <tbody>{resource.data.items.map((item) => <tr key={item.producto.id}><td>{item.producto.nombre}<small>{item.producto.sku}</small></td>
            <td>{item.cantidad}</td><td>{item.reservado}</td><td><strong>{item.disponible}</strong></td>
            <td>{!item.existencia_registrada ? 'Sin existencia registrada' : item.bajo_minimo ? 'Bajo mínimo' : 'Existencia registrada'}</td></tr>)}</tbody>
        </table>
      </div>
      {!resource.data.items.length && <p role="status">Sin productos con inventario que coincidan con esta consulta.</p>}
      <Pagination {...resource.data} onChange={(page) => setQuery({ ...query, page })} />
    </>}
    {!warehouseId && <p>Selecciona un almacén para consultar existencias.</p>}
  </div>
}
