import { useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useAuthSession } from '../auth/useAuthSession'
import { formatSaleAmount, formatSaleDate, isSaleId, saleLabel } from './sales.query'
import { useSaleDetail, useSaleFinancial } from './useSales'

export default function SaleDetail() {
  const { saleId = '' } = useParams()
  const { search } = useLocation()
  const navigate = useNavigate()
  const session = useAuthSession()
  const allowed = session?.user.permisos.some((permission) => permission.codigo === 'VENTAS.VER') ?? false
  const validId = isSaleId(saleId)
  const detail = useSaleDetail(saleId, allowed && validId)
  const financial = useSaleFinancial(saleId, allowed && validId)
  const [tab, setTab] = useState('general')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const sale = detail.data
  const summary = financial.data
  function close() {
    dialogRef.current?.close()
    navigate('/sales' + search, { replace: true })
  }

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    return () => dialog.close()
  }, [])

  const problem = !validId ? 'El identificador de la venta no es válido.'
    : detail.status === 'not-found' ? 'La venta no existe o no está disponible para tu empresa.'
    : detail.status === 'forbidden' ? 'No tienes autorización para consultar esta venta.'
    : detail.status === 'error' ? detail.error : null

  return (
    <dialog className="sale-dialog" ref={dialogRef} aria-labelledby="sale-detail-title"
      onCancel={(event) => { event.preventDefault(); close() }}
      onClick={(event) => { if (event.target === event.currentTarget) close() }}>
      <div className="sale-dialog-body">
        <header className="sale-detail-header">
          <div><p className="sales-eyebrow">CONSULTA DE DOCUMENTO</p>
            <h2 id="sale-detail-title">{sale ? 'Venta ' + sale.folio : 'Detalle de venta'}</h2>
            {sale && <p>{formatSaleDate(sale.fecha)} UTC · {sale.sucursal.nombre}</p>}</div>
          <button type="button" className="sales-button sales-button--secondary" onClick={close}>Cerrar detalle</button>
        </header>
        {detail.status === 'loading' && <div className="sales-feedback" role="status"><h3>Cargando documento…</h3></div>}
        {problem && <div className="sales-feedback" role="alert"><h3>No se puede mostrar el documento</h3><p>{problem}</p>
          {detail.status === 'error' && <button type="button" className="sales-button" onClick={detail.refresh}>Reintentar detalle</button>}</div>}
        {sale && (
          <>
            <div className="sale-detail-strip">
              <span className={'sales-badge' + (sale.estado === 'CANCELADA' ? ' sales-badge--cancelled' : '')}>{saleLabel(sale.estado)}</span>
              <span>{saleLabel(sale.condicion_pago)}</span>
              <strong>Total: {formatSaleAmount(sale.total)}</strong>
            </div>
            <nav className="sale-detail-tabs" aria-label="Secciones del detalle">
              {[['general', 'General'], ['items', 'Artículos (' + sale.detalles.length + ')'], ['payments', 'Pagos y devoluciones']].map(([value, label]) =>
                <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}
            </nav>
            {tab === 'general' && <section className="sale-detail-section" aria-label="Información general">
              <div className="sale-detail-grid">
                <div><h3>Datos del documento</h3><dl className="sale-info">
                  <div><dt>Cliente</dt><dd>{sale.cliente?.nombre ?? 'Sin cliente asociado'}</dd></div>
                  {sale.cliente && <div><dt>Código de cliente</dt><dd>{sale.cliente.codigo}</dd></div>}
                  <div><dt>Sucursal</dt><dd>{sale.sucursal.nombre}</dd></div>
                  <div><dt>Almacén</dt><dd>{sale.almacen.nombre}</dd></div>
                  <div><dt>Registró</dt><dd>{[sale.usuario.nombre, sale.usuario.apellido].filter(Boolean).join(' ') || sale.usuario.username}</dd></div>
                  <div><dt>Caja</dt><dd>{sale.sesion_caja?.caja.nombre ?? 'Sin sesión de caja asociada'}</dd></div>
                </dl></div>
                <div className="sale-totals"><h3>Importes del documento</h3><dl className="sale-info">
                  <div><dt>Subtotal</dt><dd>{formatSaleAmount(sale.subtotal)}</dd></div>
                  <div><dt>Descuentos</dt><dd>{formatSaleAmount(sale.descuento)}</dd></div>
                  <div><dt>Impuestos</dt><dd>{formatSaleAmount(sale.impuesto)}</dd></div>
                  <div className="sale-total"><dt>Total</dt><dd>{formatSaleAmount(sale.total)}</dd></div>
                </dl></div>
              </div>
              <section className="sale-observations"><h3>Observaciones</h3><p>{sale.observaciones?.trim() || 'Sin observaciones registradas.'}</p></section>
            </section>}
            {tab === 'items' && <section className="sale-detail-section" aria-label="Artículos vendidos">
              <h3>Artículos del documento</h3>
              <div className="sales-table-scroll" tabIndex={0} role="region" aria-label="Artículos con desplazamiento horizontal">
                <table className="sales-table"><caption className="sales-sr-only">Desglose de los artículos vendidos</caption>
                  <thead><tr><th scope="col">Artículo / SKU</th><th scope="col">Cantidad</th><th scope="col">Precio unitario</th>
                    <th scope="col">Descuento</th><th scope="col">Impuesto</th><th scope="col">Importe</th></tr></thead>
                  <tbody>{sale.detalles.map((item) => <tr key={item.id}>
                    <td><strong>{item.descripcion || item.producto.nombre}</strong><small>{item.producto.sku}</small></td>
                    <td className="sales-number">{new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 }).format(item.cantidad)}</td>
                    <td className="sales-number">{formatSaleAmount(item.precio_unitario)}</td>
                    <td className="sales-number">{formatSaleAmount(item.descuento_importe)}<small>{item.descuento_porcentaje}%</small></td>
                    <td className="sales-number">{formatSaleAmount(item.impuesto_importe)}</td>
                    <td className="sales-number"><strong>{formatSaleAmount(item.total_linea)}</strong></td>
                  </tr>)}</tbody>
                </table>
              </div>
              {sale.detalles.length === 0 && <p className="sales-empty">El documento no contiene artículos.</p>}
            </section>}
            {tab === 'payments' && <section className="sale-detail-section" aria-label="Pagos y devoluciones">
              <h3>Pagos originales</h3>
              <div className="sales-table-scroll" tabIndex={0} role="region" aria-label="Pagos con desplazamiento horizontal">
                <table className="sales-table"><caption className="sales-sr-only">Pagos registrados en la venta original</caption>
                  <thead><tr><th scope="col">Método</th><th scope="col">Fecha UTC</th><th scope="col">Referencia</th><th scope="col">Importe</th></tr></thead>
                  <tbody>{sale.pagos.map((payment) => <tr key={payment.id}>
                    <td>{payment.metodo_pago.nombre}</td><td>{formatSaleDate(payment.fecha)}</td>
                    <td>{payment.referencia || 'Sin referencia'}</td><td className="sales-number">{formatSaleAmount(payment.monto)}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              <div className="sale-return-summary"><h3>Devoluciones registradas</h3>
                <p>{sale.devoluciones.total_devoluciones} {sale.devoluciones.total_devoluciones === 1 ? 'devolución' : 'devoluciones'} · Importe devuelto: <strong>{formatSaleAmount(sale.devoluciones.total_devuelto)}</strong></p></div>
              <h3>Resumen financiero</h3>
              {financial.status === 'loading' && <p role="status">Consultando resumen financiero…</p>}
              {['error', 'forbidden', 'not-found'].includes(financial.status) && <div className="sales-error" role="alert">
                <p>El resumen financiero no está disponible. Puedes seguir consultando el documento y sus pagos originales.</p>
                {financial.status === 'error' && <button type="button" className="sales-button sales-button--secondary" onClick={financial.refresh}>Reintentar resumen</button>}</div>}
              {summary && <>
                <span className="sales-badge">{saleLabel(summary.resumen.estado_financiero)}</span>
                <dl className="sale-info sale-financial-grid">
                  <div><dt>Pagos registrados</dt><dd>{formatSaleAmount(summary.resumen.total_pagos_registrados)}</dd></div>
                  <div><dt>Devuelto</dt><dd>{formatSaleAmount(summary.resumen.total_devuelto)}</dd></div>
                  <div><dt>Revertido por cancelación</dt><dd>{formatSaleAmount(summary.resumen.total_revertido_cancelacion)}</dd></div>
                  <div><dt>Venta neta</dt><dd>{formatSaleAmount(summary.resumen.total_neto_venta)}</dd></div>
                  <div><dt>Pagos netos</dt><dd>{formatSaleAmount(summary.resumen.total_neto_pagos)}</dd></div>
                  <div><dt>Efectivo neto</dt><dd>{formatSaleAmount(summary.efectivo.neto)}</dd></div>
                </dl>
                {summary.credito && <div className="sale-observations"><h3>Crédito registrado</h3>
                  <p>Crédito neto después de devoluciones: <strong>{formatSaleAmount(summary.credito.monto_neto_post_devoluciones)}</strong></p>
                  {!summary.credito.cuentas_por_cobrar_integrado && <p className="sales-muted">El seguimiento de abonos y saldos está pendiente de integración.</p>}
                </div>}
              </>}
            </section>}
          </>
        )}
      </div>
    </dialog>
  )
}
