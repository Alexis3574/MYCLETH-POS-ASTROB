import { useState } from 'react'
import { usePermission, useProducts } from '../commercial/commercial.hooks'
import type { Product } from '../commercial/commercial.types'
import Pagination from '../commercial/Pagination'
import QueryFeedback from '../commercial/QueryFeedback'
import SearchForm from '../commercial/SearchForm'

export default function ProductBrowser({ onSelect, selecting = false }: { onSelect?: (product: Product) => void; selecting?: boolean }) {
  const allowed = usePermission('PRODUCTOS.VER')
  const [query, setQuery] = useState({ text: '', active: 'true', page: 1 })
  const resource = useProducts(query.text, query.active, query.page, allowed)
  if (!allowed) return <p role="alert">No tienes permiso para consultar productos.</p>
  return <div className="commercial-panel">
    <h2>Catálogo de productos</h2>
    <SearchForm label="Nombre, SKU o código de barras" onlyActive={selecting} onSearch={(text, active) => setQuery({ text, active, page: 1 })} />
    <QueryFeedback resource={resource} />
    {resource.data && <>
      <div className="sales-table-scroll" role="region" aria-label="Productos encontrados" tabIndex={0}>
        <table className="sales-table"><thead><tr><th>Producto</th><th>Tipo / unidad</th><th>Precio de catálogo</th><th>Impuestos activos</th><th>Estado</th>{onSelect && <th>Acción</th>}</tr></thead>
          <tbody>{resource.data.items.map((item) => <tr key={item.id}>
            <td><strong>{item.nombre}</strong><small>SKU: {item.sku} · Código: {item.codigo_barras ?? 'Sin código'}</small></td>
            <td>{item.tipo === 'SERVICIO' ? 'Servicio' : 'Producto'}<small>{item.unidad_medida.nombre} · {item.controla_inventario ? 'Con inventario' : 'Sin control de inventario'}</small></td>
            <td className="sales-number">{item.precio_venta}</td>
            <td>{item.impuestos.filter((tax) => tax.activo).map((tax) => tax.tasa + '%').join(' + ') || 'Sin impuestos activos'}</td>
            <td>{item.activo ? 'Activo' : 'Inactivo'}{!item.unidad_medida.activo && <small>Unidad inactiva</small>}</td>
            {onSelect && <td><button type="button" className="sales-button sales-button--secondary" disabled={selecting && (!item.activo || !item.unidad_medida.activo)}
              onClick={() => onSelect(item)}>{selecting ? 'Agregar' : 'Ver existencias'}<span className="sales-sr-only"> de {item.nombre}</span></button></td>}
          </tr>)}</tbody></table>
      </div>
      {!resource.data.items.length && <p className="commercial-notice" role="status">No se encontraron productos.</p>}
      <Pagination {...resource.data} onChange={(page) => setQuery({ ...query, page })} />
    </>}
  </div>
}
