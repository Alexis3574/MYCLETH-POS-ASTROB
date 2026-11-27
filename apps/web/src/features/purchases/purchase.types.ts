import type { Product } from '../commercial/commercial.types'
export interface PurchaseLineInput { producto_id: string; descripcion: string | null; cantidad: string; precio_unitario: string; descuento_porcentaje: string; tasa_impuesto: string }
export interface CreatePurchase { sucursal_id: string; almacen_id: string; proveedor_id: string; folio: string; factura_proveedor: string | null; observaciones: string | null; detalles: PurchaseLineInput[] }
export interface PurchasePaymentInput { metodo_pago_id: string; sesion_caja_id: string | null; monto: string; referencia: string | null }
export type PurchaseAction = { kind: 'create'; body: CreatePurchase } | { kind: 'receive'; purchaseId: string; body: Record<string, never> } | { kind: 'pay'; purchaseId: string; body: PurchasePaymentInput } | { kind: 'cancel'; purchaseId: string; body: { motivo: string } }
export interface PurchaseAttempt { companyId: string; userId: string; key: string; action: PurchaseAction }
export interface PurchaseDraftLine { product: Product; quantity: string; price: string; discount: string; tax: string; description: string }
export interface PurchaseRecord {
  id: string; empresa_id: string; sucursal_id: string; almacen_id: string; proveedor_id: string; usuario_id: string
  folio: string; factura_proveedor: string | null; observaciones: string | null; fecha: string; estado: 'BORRADOR' | 'RECIBIDA' | 'CANCELADA'
  subtotal: string; descuento: string; impuesto: string; total: string
  proveedor: { id: string; codigo: string; razon_social: string; activo: boolean }
  sucursal: { id: string; codigo: string; nombre: string }; almacen: { id: string; codigo: string; nombre: string }
  compra_detalle: (PurchaseLineInput & { id: string; compra_id: string; subtotal_linea: string; descuento_importe: string; impuesto_importe: string; total_linea: string; producto: { id: string; nombre: string; sku: string } })[]
  compra_pago: (PurchasePaymentInput & { id: string; compra_id: string; fecha: string; metodo_pago: { codigo: string; nombre: string; es_efectivo: boolean } })[]
  resumen_financiero: { total_pagado: string; saldo_pendiente: string }
}
