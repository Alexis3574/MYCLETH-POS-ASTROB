import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useAuthSession } from '../features/auth/useAuthSession'
import { readSalesQuery, salesSearch } from '../features/sales/sales.query'
import type { SalesFilterValues } from '../features/sales/sales.types'
import { useSalesList } from '../features/sales/useSales'
import SalesFilters from '../features/sales/SalesFilters'
import SalesTable from '../features/sales/SalesTable'
import './SalesPage.css'

export default function SalesPage() {
  const session = useAuthSession()
  const allowed = session?.user.permisos.some((permission) => permission.codigo === 'VENTAS.VER') ?? false
  const [params, setParams] = useSearchParams()
  const { search } = useLocation()
  const navigate = useNavigate()
  const { query, error: queryError } = readSalesQuery(params)
  const resource = useSalesList(search, allowed && !queryError)
  const [selection, setSelection] = useState<{ id: string; search: string } | null>(null)
  const sales = resource.data?.data ?? []
  const selected = selection?.search === search ? sales.find((sale) => sale.id === selection.id) : null
  const pagination = resource.data?.pagination
  const loading = resource.status === 'loading'

  function apply(filters: SalesFilterValues) {
    setParams(salesSearch({ ...query, ...filters, page: 1, limit: Number.isInteger(query.limit) && query.limit > 0 && query.limit <= 100 ? query.limit : 20 }))
  }
  function openSale(id: string) {
    navigate('/sales/' + id + search)
  }
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'F4' || event.ctrlKey || event.altKey || event.metaKey || !selected) return
    const target = event.target as HTMLElement
    if (target.closest('input:not([type="radio"]), select, textarea, [contenteditable="true"], dialog')) return
    event.preventDefault()
    openSale(selected.id)
  }

  if (!allowed) {
    return <section className="sales-feedback" role="alert"><h1>Acceso restringido</h1>
      <p>No tienes permiso para consultar ventas.</p></section>
  }
  return (
    <section className="sales-page" onKeyDown={handleKeyDown} aria-labelledby="sales-title">
      <header className="sales-heading">
        <div><p className="sales-eyebrow">OPERACIONES / CONSULTA</p><h1 id="sales-title">Ventas</h1>
          <p>Encuentra tus documentos y consulta el detalle de cada operación.</p></div>
        <button type="button" className="sales-button sales-button--secondary" disabled={loading || !!queryError}
          onClick={resource.refresh}>Actualizar</button>
      </header>
      <SalesFilters key={search} query={query} onApply={apply} onClear={() => setParams({})} />
      {queryError && <div className="sales-feedback" role="alert"><h2>Revisa los filtros</h2><p>{queryError}</p></div>}
      {!queryError && resource.status === 'forbidden' && <div className="sales-feedback" role="alert">
        <h2>Acceso restringido</h2><p>El servidor no permite consultar estas ventas con tu usuario.</p></div>}
      {!queryError && ['error', 'not-found'].includes(resource.status) && <div className="sales-feedback" role="alert">
        <h2>No se pudieron consultar las ventas</h2><p>{resource.error}</p>
        <button type="button" className="sales-button" onClick={resource.refresh}>Reintentar</button></div>}
      {loading && <div className="sales-feedback" role="status"><h2>Consultando ventas…</h2><p>Buscando documentos con los filtros seleccionados.</p></div>}
      {resource.status === 'success' && pagination && (
        <div className="sales-results">
          <div className="sales-results-toolbar">
            <div><h2>Documentos de venta</h2><p aria-live="polite">{pagination.total.toLocaleString('es-MX')} {pagination.total === 1 ? 'resultado' : 'resultados'}</p></div>
            <button type="button" className="sales-button" disabled={!selected}
              onClick={() => { if (selected) openSale(selected.id) }}>Mostrar <kbd>F4</kbd></button>
          </div>
          {sales.length > 0
            ? <SalesTable sales={sales} selectedId={selected?.id ?? null}
                onSelect={(id) => setSelection({ id, search })} onOpen={openSale} />
            : <div className="sales-empty" role="status"><span aria-hidden="true">▤</span><h3>No se encontraron ventas</h3>
                <p>{pagination.total > 0 ? 'Esta página no contiene documentos. Vuelve a la primera página.' : 'Prueba otro folio o modifica los filtros de búsqueda.'}</p>
                {query.page > 1 && <button type="button" className="sales-button sales-button--secondary"
                  onClick={() => setParams(salesSearch({ ...query, page: 1 }))}>Primera página</button>}</div>}
          <footer className="sales-pagination" aria-label="Paginación de ventas">
            <label>Por página <select value={query.limit}
              onChange={(event) => setParams(salesSearch({ ...query, limit: Number(event.target.value), page: 1 }))}>
              {[...new Set([10, 20, 50, 100, query.limit])].sort((a, b) => a - b).map((limit) => <option key={limit} value={limit}>{limit}</option>)}
            </select></label>
            <span>{pagination.totalPages > 0 ? 'Página ' + pagination.page + ' de ' + pagination.totalPages : 'Sin páginas'}</span>
            <div><button type="button" className="sales-button sales-button--secondary" disabled={query.page <= 1}
              onClick={() => setParams(salesSearch({ ...query, page: query.page - 1 }))}>Anterior</button>
              <button type="button" className="sales-button sales-button--secondary" disabled={query.page >= pagination.totalPages}
                onClick={() => setParams(salesSearch({ ...query, page: query.page + 1 }))}>Siguiente</button></div>
          </footer>
        </div>
      )}
      <Outlet />
    </section>
  )
}
