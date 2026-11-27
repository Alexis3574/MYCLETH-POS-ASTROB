import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiHttpError } from '../services/api'
import { clearAuthSession, getAuthSession } from '../features/auth/auth.session'
import { useAuthSession } from '../features/auth/useAuthSession'
import QuickProductSearch from '../features/products/QuickProductSearch'
import ProductBrowser from '../features/products/ProductBrowser'
import CustomerBrowser from '../features/customers/CustomerBrowser'
import WarehousePicker from '../features/commercial/WarehousePicker'
import { usePermission } from '../features/commercial/commercial.hooks'
import type { CartLine, CreatedSale, Customer, DraftPayment, PaymentMethod, Product, SaleInput, Warehouse } from '../features/commercial/commercial.types'
import { commercialService } from '../features/commercial/commercial.service'
import CashSessionPicker from '../features/cash/CashSessionPicker'
import type { CashChoice } from '../features/cash/CashSessionPicker'
import CartEditor from '../features/pos/CartEditor'
import PaymentEditor from '../features/pos/PaymentEditor'
import SaleConfirmation from '../features/pos/SaleConfirmation'
import DiscardConfirmation from '../features/pos/DiscardConfirmation'
import { addProduct, buildSaleInput, estimateSale, formatAmount } from '../features/pos/pos.logic'
import { clearPendingSale, readPendingSale, savePendingSale } from '../features/pos/submission.guard'
import type { PendingSale } from '../features/pos/submission.guard'
import { usePosDraft } from '../features/pos/usePosDraft'
import './SalesPage.css'
import './CommercialPage.css'

function readPending() {
  try { return readPendingSale(window.sessionStorage) }
  catch { return { companyId: '', branchId: '', folio: 'No disponible' } }
}
export default function PosPage() {
  const session = useAuthSession()
  const allowed = usePermission('VENTAS.CREAR')
  const viewSales = usePermission('VENTAS.VER')
  const productsAllowed = usePermission('PRODUCTOS.VER')
  const inventoryAllowed = usePermission('INVENTARIO.VER')
  const { draft, update, clear: clearDraft } = usePosDraft()
  const { warehouse, customer, notes, lines, payments, methods } = draft
  const setWarehouse = (value: Warehouse | null) => update({ warehouse: value })
  const setCustomer = (value: Customer | null) => update({ customer: value })
  const setFolio = (value: string) => update({ folio: value })
  const setNotes = (value: string) => update({ notes: value })
  const setLines = (value: CartLine[]) => update({ lines: value })
  const setPayments = (value: DraftPayment[]) => update({ payments: value })
  const setMethods = (value: PaymentMethod[]) => update({ methods: value })
  const [cash, setCash] = useState<CashChoice | null>(null)
  const [customerSearch, setCustomerSearch] = useState(false)
  const [discardConfirmation, setDiscardConfirmation] = useState(false)
  const [confirmation, setConfirmation] = useState<{ input: SaleInput; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CreatedSale | null>(null)
  const [pending, setPending] = useState<PendingSale | null>(readPending)
  const [reviewed, setReviewed] = useState(false)
  const operationKey = useRef<string | null>(null)
  const locked = useRef(pending !== null)
  const estimate = estimateSale(lines)
  const effectiveCash = cash?.register.sucursal_id === warehouse?.sucursal.id ? cash : null

  useEffect(() => {
    if (!lines.length || pending) return
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [lines.length, pending])

  function add(product: Product) {
    try { setLines(addProduct(lines, product)); setError(null); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Revisa el producto.'); return false }
  }
  function prepare() {
    if (!session || locked.current) return
    try {
      if (!productsAllowed || !inventoryAllowed) throw new Error('Necesitas consultar productos e inventario para preparar esta venta.')
      const input = buildSaleInput({ companyId: session.user.empresa.id, userId: session.user.id, warehouse, customer,
        cash: effectiveCash, folio: '', operationKey: operationKey.current ??= crypto.randomUUID(), notes, lines, payments, methods })
      setError(null)
      setConfirmation({ input, total: estimate!.total })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Revisa los datos de captura.') }
  }
  async function submit(input: SaleInput) {
    if (locked.current || !session || getAuthSession()?.accessToken !== session.accessToken) return
    locked.current = true
    setConfirmation(null)
    const attempt = { companyId: input.empresa_id, branchId: input.sucursal_id, folio: input.folio ?? 'Automático', operationKey: input.clave_idempotencia }
    try { savePendingSale(window.sessionStorage, attempt) }
    catch { locked.current = false; setError('No se pudo proteger el intento en este navegador. Habilita el almacenamiento de sesión antes de registrar.'); return }
    setPending(attempt)
    setSubmitting(true)
    try {
      const sale = await commercialService.createSale(session.accessToken, input)
      setResult(sale)
      operationKey.current = null
      clearDraft()
      try { clearPendingSale(window.sessionStorage) } catch { /* Conserva la protección si no se puede retirar. */ }
      setPending(null)
    } catch (cause) {
      // Una respuesta perdida, 408, 409 o 5xx exige comprobar el folio; nunca se reenvía automáticamente.
      const rejected = cause instanceof ApiHttpError && cause.status < 500 && ![408, 409].includes(cause.status)
      if (rejected) {
        try { clearPendingSale(window.sessionStorage); setPending(null); operationKey.current = null; locked.current = false } catch { /* Mantiene el bloqueo. */ }
      }
      if (cause instanceof ApiHttpError && cause.status === 401 && getAuthSession()?.accessToken === session.accessToken) clearAuthSession()
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar el registro de la venta.')
    } finally { setSubmitting(false) }
  }
  if (!allowed) return <section className="commercial-page"><h1>Captura de venta</h1><p role="alert">No tienes permiso para registrar ventas.</p></section>
  if (result) return <section className="commercial-page commercial-panel" role="status"><h1>Venta registrada</h1>
    <p>Folio: <strong>{result.folio}</strong> · {result.estado} · {result.condicion_pago}</p>
    <p>Total confirmado por la API: <strong>{formatAmount(result.total)}</strong></p>
    <dl className="pos-totals"><dt>Subtotal</dt><dd>{formatAmount(result.subtotal)}</dd><dt>Descuento</dt><dd>{formatAmount(result.descuento)}</dd><dt>Impuesto</dt><dd>{formatAmount(result.impuesto)}</dd></dl>
    <div className="commercial-actions">{viewSales && <Link className="sales-button" to={'/sales/' + result.id}>Ver detalle de venta</Link>}
      <button type="button" className="sales-button sales-button--secondary" onClick={() => {
        setResult(null); clearDraft(); setPayments([]); setFolio(''); setNotes(''); setCustomer(null); setCash(null); setError(null); operationKey.current = null; locked.current = false
      }}>Preparar otra venta</button></div>
  </section>
  if (pending) return <section className="commercial-page commercial-panel"><h1>Revisa el intento anterior</h1>
    <p role={submitting ? 'status' : 'alert'}>{submitting ? 'Procesando la venta. Espera antes de iniciar otra operación.' : error ?? 'Hay un intento de venta sin confirmar en este navegador.'}</p>
    {submitting && <p role="status">Esperando confirmación del servidor…</p>}
    <p>{pending.operationKey ? 'Consulta el resultado del intento anterior. Folio: ' : 'Comprueba el folio '}<strong>{pending.companyId === session?.user.empresa.id ? pending.folio : 'del intento anterior'}</strong> en su sucursal antes de habilitar otra captura.</p>
    {viewSales && !pending.operationKey && pending.companyId === session?.user.empresa.id && <Link className="sales-button" target="_blank" rel="noreferrer" to={'/sales?folio=' + encodeURIComponent(pending.folio)}>Consultar folio en otra pestaña</Link>}
    {pending.operationKey && pending.companyId === session?.user.empresa.id && <button type="button" className="sales-button" disabled={submitting} onClick={async () => {
      if (!session || !pending.operationKey) return
      setSubmitting(true)
      try {
        const sale = await commercialService.recoverSale(session.accessToken, pending.operationKey)
        setResult(sale); clearDraft(); operationKey.current = null
        try { clearPendingSale(window.sessionStorage); setPending(null) } catch { /* Mantener bloqueo persistente. */ }
      } catch (cause) {
        if (cause instanceof ApiHttpError && cause.status === 401 && getAuthSession()?.accessToken === session.accessToken) clearAuthSession()
        setError(cause instanceof Error ? cause.message : 'No se pudo verificar el intento.')
      }
      finally { setSubmitting(false) }
    }}>Consultar resultado del intento</button>}
    <p>Si no puedes comprobarlo, solicita la revisión a una persona autorizada. No cambies el folio para repetir una operación incierta.</p>
    <label className="commercial-check"><input type="checkbox" disabled={submitting} checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />Ya comprobé el resultado y puedo continuar sin duplicar la venta.</label>
    <button type="button" className="sales-button sales-button--secondary" disabled={!reviewed || submitting} onClick={() => {
      try { clearPendingSale(window.sessionStorage); setPending(null); setReviewed(false); operationKey.current = null; clearDraft(); setCash(null); setError(null); locked.current = false }
      catch { setError('No se pudo liberar la captura en este navegador.') }
    }}>Habilitar nueva captura</button>
  </section>
  return <section className="commercial-page"><header className="sales-heading"><div><p className="sales-eyebrow">OPERACIONES / MOSTRADOR</p><h1>Punto de venta</h1>
    <p>Prepara artículos, cliente y cobro antes de registrar la operación.</p></div>{viewSales && <Link className="sales-button sales-button--secondary" to="/sales">Consultar ventas</Link>}</header>
    {error && <div className="commercial-notice commercial-error" role="alert">{error}</div>}
    {submitting && <p role="status">Registrando venta… espera la respuesta antes de salir.</p>}
    <fieldset className="pos-fields" disabled={submitting}>
      <div className="pos-workspace"><div className="pos-main">
        <div className="commercial-panel"><WarehousePicker value={warehouse} onChange={setWarehouse} />
<p className="sales-muted">Folio automático: se asignará al registrar la venta.</p></div>
        {productsAllowed && <QuickProductSearch onSelect={add} />}
        <ProductBrowser onSelect={add} selecting />
        <CartEditor lines={lines} warehouseId={warehouse?.id ?? ''} onChange={setLines} />
        {lines.length > 0 && <button type="button" className="sales-button sales-button--secondary" onClick={() => setDiscardConfirmation(true)}>Descartar captura</button>}
        <div className="commercial-panel"><h2>Cliente de la operación</h2><p>{customer ? customer.nombre + ' · ' + customer.codigo : 'Venta sin cliente seleccionado'}</p>
          <div className="commercial-actions"><button type="button" className="sales-button sales-button--secondary" onClick={() => setCustomerSearch(!customerSearch)}>{customerSearch ? 'Cerrar búsqueda de clientes' : 'Buscar cliente'}</button>
            {customer && <button type="button" className="sales-button sales-button--secondary" onClick={() => setCustomer(null)}>Quitar cliente</button>}</div>
          {customerSearch && <CustomerBrowser onSelect={(item) => { setCustomer(item); setCustomerSearch(false) }} />}</div>
        <label className="commercial-panel">Observaciones<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      </div><aside className="pos-summary" aria-label="Resumen y cobro">
        <section className="commercial-panel"><h2>Importes estimados</h2><dl className="pos-totals">
          <dt>Subtotal</dt><dd>{estimate ? formatAmount(estimate.subtotal) : '—'}</dd>
          <dt>Descuento</dt><dd>{estimate ? formatAmount(estimate.descuento) : '—'}</dd>
          <dt>Impuesto</dt><dd>{estimate ? formatAmount(estimate.impuesto) : '—'}</dd>
          <dt><strong>Total estimado</strong></dt><dd><strong>{estimate ? formatAmount(estimate.total) : '—'}</strong></dd>
        </dl><p className="sales-muted">La API recalcula con los precios e impuestos vigentes y confirma el importe definitivo.</p></section>
        <PaymentEditor total={estimate?.total ?? 0} payments={payments} knownMethods={methods} onChange={setPayments} onMethod={(method) => setMethods([...methods.filter((item) => item.id !== method.id), method])} />
        {warehouse && <CashSessionPicker key={warehouse.sucursal.id} branchId={warehouse.sucursal.id} onSelect={setCash} />}
        {effectiveCash && <p role="status">Caja para efectivo: {effectiveCash.register.nombre}</p>}
        <button type="button" className="sales-button pos-register" disabled={!lines.length || !warehouse || !productsAllowed || !inventoryAllowed} onClick={prepare}>Revisar y registrar venta</button>
      </aside></div>
    </fieldset>
    {discardConfirmation && <DiscardConfirmation onKeep={() => setDiscardConfirmation(false)} onDiscard={() => {
      clearDraft(); setCash(null); setError(null); setDiscardConfirmation(false)
    }} />}
    {confirmation && <SaleConfirmation input={confirmation.input} total={confirmation.total} onCancel={() => setConfirmation(null)} onConfirm={() => void submit(confirmation.input)} />}
  </section>
}
