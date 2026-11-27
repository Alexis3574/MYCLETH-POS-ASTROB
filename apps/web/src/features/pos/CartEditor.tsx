import type { CartLine } from '../commercial/commercial.types'
import { useStock } from '../commercial/commercial.hooks'
import QueryFeedback from '../commercial/QueryFeedback'
import { lineError } from './pos.logic'

function Availability({ line, warehouse }: { line: CartLine; warehouse: string }) {
  const resource = useStock(warehouse, '', 1, !!warehouse && line.product.controla_inventario, line.product.id)
  if (!line.product.controla_inventario) return <span>Sin control de inventario</span>
  if (!warehouse) return <span>Selecciona almacén</span>
  const stock = resource.data?.items.find((item) => item.producto.id === line.product.id)
  return <><QueryFeedback resource={resource} />{resource.status === 'success' && <span>
    Disponible: {stock?.disponible ?? 'No disponible'}{stock && Number(line.quantity) > Number(stock.disponible) && <strong className="commercial-error"> · Cantidad superior al disponible</strong>}
  </span>}</>
}
export default function CartEditor({ lines, warehouseId, onChange }: { lines: CartLine[]; warehouseId: string; onChange: (lines: CartLine[]) => void }) {
  function update(index: number, values: Partial<CartLine>) { onChange(lines.map((line, i) => i === index ? { ...line, ...values } : line)) }
  return <section className="commercial-panel"><h2>Carrito · {lines.length} artículos</h2>
    {!lines.length && <p role="status">Busca un producto y pulsa Agregar para preparar la venta.</p>}
    {lines.map((line, index) => <div className="pos-cart-line" key={line.product.id}>
      <div><strong>{line.product.nombre}</strong><p className="sales-muted">{line.product.sku} · Precio de catálogo: {line.product.precio_venta}</p>
        <div className="sales-muted"><Availability line={line} warehouse={warehouseId} /></div></div>
      <label>Cantidad de {line.product.nombre}<input type="text" inputMode="decimal" value={line.quantity} maxLength={20} onChange={(event) => update(index, { quantity: event.target.value })} /></label>
      <label>Descuento % de {line.product.nombre}<input type="text" inputMode="decimal" value={line.discount} maxLength={10} onChange={(event) => update(index, { discount: event.target.value })} /></label>
      <button type="button" className="sales-button sales-button--secondary" onClick={() => onChange(lines.filter((_, i) => i !== index))}>Quitar<span className="sales-sr-only"> {line.product.nombre}</span></button>
      {lineError(line) && <p role="alert" className="commercial-error">{lineError(line)}</p>}
    </div>)}
  </section>
}
