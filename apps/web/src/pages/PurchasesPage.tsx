import { useCallback, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuthSession } from '../features/auth/useAuthSession'
import { usePermission } from '../features/commercial/commercial.hooks'
import { useRemoteResource } from '../hooks/useRemoteResource'
import Pagination from '../features/commercial/Pagination'
import QueryFeedback from '../features/commercial/QueryFeedback'
import SupplierBrowser from '../features/suppliers/SupplierBrowser'
import { usePurchaseMutation } from '../features/purchases/usePurchaseMutation'
import { usePurchaseDraft } from '../features/purchases/usePurchaseDraft'
import PurchasePending from '../features/purchases/PurchasePending'
import PurchaseCreate from '../features/purchases/PurchaseCreate'
import PurchaseDetail from '../features/purchases/PurchaseDetail'
import { purchaseService } from '../features/purchases/purchase.service'
import { isSaleId, formatSaleAmount, formatSaleDate } from '../features/sales/sales.query'
import './SalesPage.css'
import './CommercialPage.css'
import '../features/purchases/purchases.css'

export default function PurchasesPage() { const auth = useAuthSession(); return auth ? <Purchases key={auth.accessToken} /> : null }
function Purchases() {
  const allowed = usePermission('COMPRAS.VER'), canCreate = usePermission('COMPRAS.CREAR')
  const { purchaseId = '' } = useParams(), [params, setParams] = useSearchParams(), navigate = useNavigate()
  const state = params.get('estado') ?? '', supplierId = params.get('proveedor_id') ?? '', page = Number(params.get('page') ?? '1')
  const invalid = !['','BORRADOR','RECIBIDA','CANCELADA'].includes(state) || supplierId !== '' && !isSaleId(supplierId) || !Number.isSafeInteger(page) || page < 1 || page > 1000000
  const [revision, setRevision] = useState(0), [notice, setNotice] = useState(''), [supplierSearch, setSupplierSearch] = useState(false), [supplierLabel, setSupplierLabel] = useState('')
  const draft = usePurchaseDraft()
  const mutation = usePurchaseMutation((purchase, kind) => { if (kind === 'create') draft.clear(); setNotice('Operación de compra confirmada: ' + purchase.folio); setRevision(value => value + 1); navigate('/purchases/' + purchase.id + (params.size ? '?' + params.toString() : '')) })
  const load = useCallback((token: string, signal: AbortSignal) => purchaseService.list(token, state, supplierId, page, signal), [state, supplierId, page])
  const resource = useRemoteResource(`purchases:${state}:${supplierId}:${page}:${revision}`, allowed && !purchaseId && !invalid, load)
  const backTo = '/purchases' + (params.size ? '?' + params.toString() : '')
  function filter(name: string, value: string) { const next = new URLSearchParams(params); next.delete('page'); if (value) next.set(name, value); else next.delete(name); setParams(next) }
  return <section className="commercial-page"><header className="sales-heading"><div><p className="sales-eyebrow">ABASTECIMIENTO</p><h1>{purchaseId === 'new' ? 'Nueva compra' : purchaseId ? 'Detalle de compra' : 'Compras'}</h1><p>Captura, recepción de mercancía y pagos a proveedores.</p></div>{!purchaseId && canCreate && <Link className="sales-button" to={'/purchases/new' + (params.size ? '?' + params.toString() : '')}>Nueva compra</Link>}</header>
    {!allowed ? <p role="alert">No tienes permiso para consultar compras.</p> : mutation.pending ? <PurchasePending mutation={mutation} /> : <>
      {notice && <p role="status" className="commercial-notice">{notice}</p>}
      {purchaseId === 'new' ? <PurchaseCreate backTo={backTo} error={mutation.error} onConfirm={mutation.run} /> : purchaseId ? isSaleId(purchaseId)
        ? <PurchaseDetail key={purchaseId + ':' + revision} id={purchaseId} backTo={backTo} error={mutation.error} onConfirm={mutation.run} />
        : <p role="alert">La ruta de compra no es válida. <Link to="/purchases">Volver al listado</Link></p> : <>
          <section className="commercial-panel"><div className="purchase-fields"><label>Estado de compra<select value={state} onChange={event => filter('estado', event.target.value)}><option value="">Todos</option><option value="BORRADOR">Borrador</option><option value="RECIBIDA">Recibida</option><option value="CANCELADA">Cancelada</option></select></label><div><p>Proveedor: {supplierId ? supplierLabel || 'Filtro aplicado' : 'Todos'}</p><button type="button" className="sales-button sales-button--secondary" onClick={() => setSupplierSearch(value => !value)}>Filtrar por proveedor</button>{supplierId && <button type="button" className="sales-button sales-button--secondary" onClick={() => { filter('proveedor_id',''); setSupplierLabel('') }}>Quitar proveedor</button>}</div></div><div className="commercial-actions"><button type="button" className="sales-button sales-button--secondary" onClick={() => setRevision(value => value + 1)}>Actualizar compras</button><button type="button" className="sales-button sales-button--secondary" onClick={() => { setParams({}); setSupplierLabel('') }}>Restablecer filtros</button></div></section>
          {supplierSearch && <SupplierBrowser onSelect={supplier => { filter('proveedor_id', supplier.id); setSupplierLabel(supplier.razon_social); setSupplierSearch(false) }} />}
          {invalid ? <p role="alert">Los filtros o la paginación no son válidos. Restablece los filtros para consultar.</p> : <><QueryFeedback resource={resource} />{resource.data && <section className="commercial-panel"><h2>Compras registradas</h2><div className="sales-table-scroll"><table className="sales-table"><thead><tr><th>Folio / fecha UTC</th><th>Proveedor / almacén</th><th>Estado</th><th className="sales-number">Total</th><th>Detalle</th></tr></thead><tbody>{resource.data.items.map(row => <tr key={row.id}><td>{row.folio}<small>{formatSaleDate(row.fecha)} UTC</small></td><td>{row.proveedor.razon_social}<small>{row.sucursal.nombre} / {row.almacen.nombre}</small></td><td>{row.estado === 'BORRADOR' ? 'Borrador' : row.estado === 'RECIBIDA' ? 'Recibida' : 'Cancelada'}</td><td className="sales-number">{formatSaleAmount(Number(row.total))}</td><td><Link className="sales-detail-link" to={'/purchases/' + row.id + (params.size ? '?' + params.toString() : '')}>Ver compra {row.folio}</Link></td></tr>)}</tbody></table></div>{!resource.data.items.length && <p role="status">No se encontraron compras.</p>}<Pagination {...resource.data} onChange={nextPage => { const next = new URLSearchParams(params); next.set('page', String(nextPage)); setParams(next) }} /></section>}</>}
        </>}
    </>}
  </section>
}
