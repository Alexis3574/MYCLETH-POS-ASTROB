import type { SaleListItem } from './sales.types'
import { formatSaleAmount, formatSaleDate, saleLabel } from './sales.query'

interface Props {
  sales: SaleListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
}
export default function SalesTable({ sales, selectedId, onSelect, onOpen }: Props) {
  return (
    <div className="sales-table-scroll" tabIndex={0} role="region" aria-label="Tabla de ventas con desplazamiento horizontal">
      <table className="sales-table">
        <caption className="sales-sr-only">Ventas encontradas. Selecciona una venta y usa Mostrar o F4 para ver su detalle.</caption>
        <thead><tr><th scope="col"><span className="sales-sr-only">Selección</span></th>
          <th scope="col">Folio / fecha</th><th scope="col">Cliente</th><th scope="col">Sucursal / almacén</th>
          <th scope="col">Registró</th><th scope="col">Pago</th><th scope="col">Estado</th>
          <th scope="col" className="sales-number">Total</th><th scope="col">Detalle</th>
        </tr></thead>
        <tbody>{sales.map((sale) => (
          <tr key={sale.id} className={selectedId === sale.id ? 'is-selected' : ''}
            onClick={() => onSelect(sale.id)} onDoubleClick={() => onOpen(sale.id)}>
            <td><input type="radio" name="selected-sale" checked={selectedId === sale.id}
              aria-label={'Seleccionar venta ' + sale.folio + ' de ' + sale.sucursal.nombre}
              onChange={() => onSelect(sale.id)} /></td>
            <td><strong className="sales-folio">{sale.folio}</strong><small>{formatSaleDate(sale.fecha)}</small></td>
            <td>{sale.cliente?.nombre ?? 'Sin cliente asociado'}{sale.cliente && <small>{sale.cliente.codigo}</small>}</td>
            <td>{sale.sucursal.nombre}<small>{sale.almacen.nombre}</small></td>
            <td>{[sale.usuario.nombre, sale.usuario.apellido].filter(Boolean).join(' ') || sale.usuario.username}</td>
            <td><span className="sales-payment">{saleLabel(sale.condicion_pago)}</span></td>
            <td><span className={'sales-badge' + (sale.estado === 'CANCELADA' ? ' sales-badge--cancelled' : '')}>{saleLabel(sale.estado)}</span></td>
            <td className="sales-number"><strong>{formatSaleAmount(sale.total)}</strong></td>
            <td><button type="button" className="sales-detail-link" onClick={() => onOpen(sale.id)}
              aria-label={'Ver detalle de ' + sale.folio}>Ver detalle <span aria-hidden="true">↗</span></button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}
