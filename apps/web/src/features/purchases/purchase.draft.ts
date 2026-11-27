import type { Product, Warehouse } from '../commercial/commercial.types'
import type { Supplier } from '../suppliers/supplier.types'
import type { PurchaseDraftLine } from './purchase.types'
import { decimal, scaled } from './purchase.logic.ts'
export interface PurchaseDraft { warehouse: Warehouse | null; supplier: Supplier | null; folio: string; invoice: string; notes: string; lines: PurchaseDraftLine[] }
const empty = (): PurchaseDraft => ({ warehouse: null, supplier: null, folio: '', invoice: '', notes: '', lines: [] })
export function createPurchaseDraftStore() {
  let owner = '', draft = empty()
  const blank = empty(), listeners = new Set<() => void>()
  return {
    get(identity: string) { return owner === identity ? draft : blank },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    update(identity: string, patch: Partial<PurchaseDraft>) { draft = { ...(owner === identity ? draft : empty()), ...patch }; owner = identity; listeners.forEach(listener => listener()) },
    clear() { owner = ''; draft = blank; listeners.forEach(listener => listener()) },
  }
}
export function addPurchaseProduct(lines: PurchaseDraftLine[], product: Product): PurchaseDraftLine[] {
  if (!product.activo || !product.unidad_medida.activo) throw new Error('El producto o su unidad están inactivos.')
  if (product.controla_inventario && (product.tipo !== 'PRODUCTO' || !product.codigo_barras)) throw new Error('Este producto inventariable necesita código de barras para recibirse.')
  if (lines.some(line => line.product.id === product.id)) return lines.map(line => {
    if (line.product.id !== product.id) return line
    const quantity = scaled(decimal(line.quantity, 3, true), 3) + 1000n
    return { ...line, quantity: decimal(quantity / 1000n + '.' + String(quantity % 1000n).padStart(3,'0'), 3, true) }
  })
  if (lines.length >= 100) throw new Error('La compra admite hasta 100 productos distintos.')
  return [...lines, { product, quantity: '1', price: '', discount: '0', tax: '0', description: '' }]
}
