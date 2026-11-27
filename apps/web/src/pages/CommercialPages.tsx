import { useState } from 'react'
import ProductBrowser from '../features/products/ProductBrowser'
import CustomerBrowser from '../features/customers/CustomerBrowser'
import StockBrowser from '../features/inventory/StockBrowser'
import WarehousePicker from '../features/commercial/WarehousePicker'
import { usePermission } from '../features/commercial/commercial.hooks'
import type { Product, Warehouse } from '../features/commercial/commercial.types'
import CashWorkspace from '../features/cash/CashWorkspace'
import InventoryWorkspace from '../features/inventory/InventoryWorkspace'
import type { ReactNode } from 'react'
import './SalesPage.css'
import './CommercialPage.css'

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return <section className="commercial-page"><header className="sales-heading"><div><p className="sales-eyebrow">OPERACIÓN COMERCIAL</p><h1>{title}</h1></div></header>{children}</section>
}
export function ProductsPage() {
  const inventory = usePermission('INVENTARIO.VER')
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null)
  const [product, setProduct] = useState<Product | null>(null)
  return <Frame title="Productos"><ProductBrowser onSelect={inventory ? setProduct : undefined} />
    {inventory && product && <><h2>Existencias de {product.nombre}</h2>{!product.controla_inventario ? <p>Este artículo no controla inventario.</p> : <>
      <WarehousePicker value={warehouse} onChange={setWarehouse} />
      <StockBrowser key={warehouse?.id + ':' + product.id} warehouseId={warehouse?.id ?? ''} productId={product.id} />
    </>}</>}
  </Frame>
}
export function CustomersPage() { return <Frame title="Clientes"><CustomerBrowser /></Frame> }
export function InventoryPage() {
  return <Frame title="Inventario"><InventoryWorkspace/></Frame>
}
export function CashPage() {
  return <Frame title="Caja"><CashWorkspace /></Frame>
}
