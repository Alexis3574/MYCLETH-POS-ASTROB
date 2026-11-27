import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAuthSession } from '../auth/useAuthSession'
import { usePermission } from '../commercial/commercial.hooks'
import WarehousePicker from '../commercial/WarehousePicker'
import ProductBrowser from '../products/ProductBrowser'
import QuickProductSearch from '../products/QuickProductSearch'
import SupplierBrowser from '../suppliers/SupplierBrowser'
import { formatSaleAmount } from '../sales/sales.query'
import { addPurchaseProduct } from './purchase.draft'
import { usePurchaseDraft } from './usePurchaseDraft'
import { buildPurchase, estimatePurchase } from './purchase.logic'
import type { CreatePurchase, PurchaseAction } from './purchase.types'
import type { Product } from '../commercial/commercial.types'

export default function PurchaseCreate({ onConfirm, error, backTo }: { onConfirm: (action: PurchaseAction) => void; error: string; backTo: string }) {
  const auth = useAuthSession()!, canCreate = usePermission('COMPRAS.CREAR'), canProducts = usePermission('PRODUCTOS.VER'), canInventory = usePermission('INVENTARIO.VER'), canSuppliers = usePermission('PROVEEDORES.VER')
  const { draft, update, clear } = usePurchaseDraft()
  const [choosing, setChoosing] = useState(false), [validation, setValidation] = useState(''), [proposal, setProposal] = useState<CreatePurchase | null>(null), [discard, setDiscard] = useState(false)
  const back = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => { if (proposal || discard) back.current?.focus() }, [proposal, discard])
  useEffect(() => {
    if (!draft.lines.length) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [draft.lines.length])
  if (!canCreate) return <p role="alert">No tienes permiso para registrar compras.</p>
  function add(product: Product) { try { update({ lines: addPurchaseProduct(draft.lines, product) }); setValidation(''); return true } catch (cause) { setValidation(cause instanceof Error ? cause.message : 'Revisa el producto.'); return false } }
  function review() {
    try {
      if (!canProducts || !canInventory || !canSuppliers) throw new Error('La captura requiere acceso a productos, inventario y proveedores.')
      if (!draft.warehouse?.activo || !draft.warehouse.sucursal.activo || draft.warehouse.sucursal.empresa_id !== auth.user.empresa.id || !draft.supplier?.activo || draft.supplier.empresa_id !== auth.user.empresa.id) throw new Error('Selecciona almacén y proveedor activos de tu empresa.')
      const input = buildPurchase({ sucursal_id: draft.warehouse.sucursal.id, almacen_id: draft.warehouse.id, proveedor_id: draft.supplier.id, folio: draft.folio, factura_proveedor: draft.invoice || null, observaciones: draft.notes || null }, draft.lines, auth.user.empresa.id)
      estimatePurchase(input.detalles); setProposal(input); setValidation('')
    } catch (cause) { setValidation(cause instanceof Error ? cause.message : 'Revisa la captura.') }
  }
  if (discard) return <section className="commercial-panel"><h2>Descartar captura de compra</h2><p>Se retirarán los datos locales que todavía no has guardado como borrador.</p><div className="commercial-actions"><button ref={back} type="button" className="sales-button sales-button--secondary" onClick={() => setDiscard(false)}>Conservar captura</button><button type="button" className="sales-button" onClick={() => { clear(); setDiscard(false) }}>Descartar captura</button></div></section>
  if (proposal) return <section className="commercial-panel purchase-confirm" aria-label="Confirmación de compra"><h2>Confirmar borrador de compra</h2><p>Folio: <strong>{proposal.folio}</strong> · {draft.supplier?.razon_social}</p><p>{draft.warehouse?.sucursal.nombre} / {draft.warehouse?.nombre}</p><p>{proposal.detalles.length} productos · Total estimado: <strong>{formatSaleAmount(Number(estimatePurchase(proposal.detalles).total))}</strong></p>
    <p>Se guarda un borrador con sus importes. Recibir mercancía y registrar pagos son acciones posteriores con confirmación propia. El servidor confirma los importes definitivos.</p>{error && <p role="alert" className="sales-error">{error}</p>}
    <div className="commercial-actions"><button ref={back} type="button" className="sales-button sales-button--secondary" onClick={() => setProposal(null)}>Volver a editar compra</button><button type="button" className="sales-button" onClick={() => onConfirm({ kind: 'create', body: proposal })}>Confirmar borrador</button></div></section>
  return <>
    <div className="commercial-actions"><Link className="sales-button sales-button--secondary" to={backTo}>Volver a compras</Link><button type="button" className="sales-button sales-button--secondary" onClick={() => setDiscard(true)}>Descartar captura de compra</button></div>
    <section className="commercial-panel"><h2>Datos de la compra</h2><WarehousePicker value={draft.warehouse} onChange={warehouse => update({ warehouse })} />
      <p>Proveedor: <strong>{draft.supplier?.razon_social ?? 'Selecciona un proveedor'}</strong></p><button type="button" className="sales-button sales-button--secondary" onClick={() => setChoosing(value => !value)}>{choosing ? 'Cerrar búsqueda de proveedor' : 'Buscar proveedor'}</button>
      <div className="purchase-fields"><label>Folio de compra<input maxLength={50} value={draft.folio} onChange={event => update({ folio: event.target.value })} /></label><label>Factura del proveedor (opcional)<input maxLength={80} value={draft.invoice} onChange={event => update({ invoice: event.target.value })} /></label></div>
      <label>Observaciones de compra<textarea maxLength={2000} value={draft.notes} onChange={event => update({ notes: event.target.value })} /></label><p className="sales-muted">La API actual exige folio. La captura se conserva al navegar dentro de la aplicación; una recarga completa descarta los datos que aún no se guardaron.</p>
    </section>
    {choosing && <SupplierBrowser onSelect={supplier => { update({ supplier }); setChoosing(false) }} />}
    {canProducts && <><QuickProductSearch onSelect={add} /><div className="purchase-catalog"><ProductBrowser selecting onSelect={add} /></div></>}
    <section className="commercial-panel"><h2>Artículos de compra · {draft.lines.length}</h2><p className="sales-muted">El catálogo muestra precios de venta. Captura aquí el costo unitario de compra y los porcentajes de la factura; no se sustituyen por los precios del catálogo.</p>
      {draft.lines.map(line => <article key={line.product.id} className="purchase-line"><h3>{line.product.nombre}<small>{line.product.sku}</small></h3><div className="purchase-fields">
        {([['quantity','Cantidad'],['price','Costo unitario'],['discount','Descuento %'],['tax','Impuesto %']] as const).map(([field,label]) => <label key={field}>{label} · {line.product.sku}<input inputMode="decimal" value={line[field]} onChange={event => { update({ lines: draft.lines.map(row => row.product.id === line.product.id ? { ...row, [field]: event.target.value } : row) }); setValidation('') }} /></label>)}
        <label>Descripción · {line.product.sku}<input maxLength={250} value={line.description} onChange={event => update({ lines: draft.lines.map(row => row.product.id === line.product.id ? { ...row, description: event.target.value } : row) })} /></label>
      </div><button type="button" className="sales-button sales-button--secondary" onClick={() => update({ lines: draft.lines.filter(row => row.product.id !== line.product.id) })}>Quitar {line.product.sku}</button></article>)}
      {!draft.lines.length && <p>Agrega productos mediante su código o el catálogo.</p>}{(validation || error) && <p role="alert" className="sales-error">{validation || error}</p>}
      <button type="button" className="sales-button" onClick={review}>Revisar borrador de compra</button>
    </section>
  </>
}
