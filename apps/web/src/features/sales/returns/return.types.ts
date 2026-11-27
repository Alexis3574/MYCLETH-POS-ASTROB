import type { SaleItem, SalePayment } from '../sales.types.ts'

export interface ReturnLine {
  id: string; venta_detalle_id: string; cantidad: number
  subtotal_linea: number; descuento_importe: number; impuesto_importe: number; total_linea: number
  producto: { id: string; sku: string; nombre: string }
}
export interface ReturnRefund {
  id: string; venta_pago_id: string; monto: number; referencia: string | null
  metodo_pago: SalePayment['metodo_pago']
}
export interface SaleReturn {
  id: string; venta_id: string; usuario_id: string; folio: string; motivo: string; fecha: string; total: number
  detalles: ReturnLine[]; reembolsos: ReturnRefund[]
}
export interface ReturnsData {
  venta: { id: string; estado: string; folio: string; total: number }
  total_devoluciones: number; total_devuelto: number; devoluciones: SaleReturn[]
}
export interface ItemBalance { item: SaleItem; available: number; returned: number; returnedTotal: number }
export interface PaymentBalance { payment: SalePayment; available: number }
export interface RefundDraft { amount: string; reference: string }
export interface ReturnInput {
  folio: string; motivo: string; sesion_caja_id: string | null
  detalles: { venta_detalle_id: string; cantidad: string }[]
  reembolsos: { venta_pago_id: string; monto: string; referencia: string | null }[]
}
export interface ActionResult { id: string; folio: string; total?: number; estado?: string }
