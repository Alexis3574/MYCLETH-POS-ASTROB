import { useCallback, useState } from 'react'
import { useRemoteResource } from '../../hooks/useRemoteResource'
import { usePermission } from '../commercial/commercial.hooks'
import Pagination from '../commercial/Pagination'
import QueryFeedback from '../commercial/QueryFeedback'
import SearchForm from '../commercial/SearchForm'
import { supplierService } from './supplier.service'
import type { Supplier } from './supplier.types'

export default function SupplierBrowser({ onSelect }: { onSelect?: (supplier: Supplier) => void }) {
  const allowed = usePermission('PROVEEDORES.VER')
  const [query, setQuery] = useState({ text: '', active: 'true', page: 1 }), [id, setId] = useState('')
  const load = useCallback((token: string, signal: AbortSignal) => supplierService.list(token, query.text, query.active, query.page, signal), [query])
  const resource = useRemoteResource('suppliers:' + JSON.stringify(query), allowed, load)
  const detailLoad = useCallback((token: string, signal: AbortSignal) => supplierService.detail(token, id, signal), [id])
  const detail = useRemoteResource('supplier:' + id, allowed && !!id, detailLoad)
  if (!allowed) return <p role="alert">No tienes permiso para consultar proveedores.</p>
  return <section className="commercial-panel"><h2>Proveedores</h2>
    <SearchForm label="Proveedor: nombre, código, RFC o contacto" onlyActive={!!onSelect} onSearch={(text, active) => setQuery({ text, active, page: 1 })} />
    <QueryFeedback resource={resource} />
    {resource.data && <><div className="sales-table-scroll"><table className="sales-table"><caption className="sales-sr-only">Proveedores encontrados</caption><thead><tr><th>Proveedor</th><th>Contacto</th><th>Condiciones</th><th>Acción</th></tr></thead><tbody>
      {resource.data.items.map(row => <tr key={row.id}><td><strong>{row.razon_social}</strong><small>{row.codigo} · {row.rfc ?? 'Sin RFC'}{row.nombre_comercial ? ' · ' + row.nombre_comercial : ''}</small></td><td>{row.contacto ?? 'Sin contacto'}<small>{row.email ?? 'Sin correo'} · {row.telefono ?? 'Sin teléfono'}</small></td><td>{row.activo ? 'Activo' : 'Inactivo'}<small>{row.dias_credito} días de crédito configurados</small></td><td><button type="button" className="sales-detail-link" disabled={!!onSelect && !row.activo} onClick={() => onSelect ? onSelect(row) : setId(row.id)}>{onSelect ? 'Seleccionar' : 'Ver proveedor'}<span className="sales-sr-only"> {row.codigo}</span></button></td></tr>)}
    </tbody></table></div>{!resource.data.items.length && <p role="status">No se encontraron proveedores.</p>}<Pagination {...resource.data} onChange={page => setQuery({ ...query, page })} /></>}
    {id && !onSelect && <section className="purchase-supplier-detail" aria-label="Detalle del proveedor"><QueryFeedback resource={detail} />{detail.data && <><h3>{detail.data.razon_social}</h3><p>{detail.data.nombre_comercial ?? detail.data.codigo}</p><p>RFC: {detail.data.rfc ?? 'Sin RFC'} · Contacto: {detail.data.contacto ?? 'Sin contacto'}</p>
      <h4>Domicilios</h4>{detail.data.proveedor_direccion.length ? detail.data.proveedor_direccion.map(address => <p key={address.id}>{address.tipo}{address.es_principal ? ' · Principal' : ''}: {[address.calle, address.numero_exterior, address.numero_interior, address.colonia, address.municipio, address.estado, address.codigo_postal, address.pais].filter(Boolean).join(', ')}</p>) : <p>No hay domicilios registrados.</p>}
    </>}<button type="button" className="sales-button sales-button--secondary" onClick={() => setId('')}>Cerrar proveedor</button></section>}
  </section>
}
