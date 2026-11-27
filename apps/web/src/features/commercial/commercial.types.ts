export interface Page<T> { items: T[]; total: number; page: number; size: number }
export interface Product {
  id: string; empresa_id: string; sku: string; codigo_barras: string | null; nombre: string
  tipo: 'PRODUCTO' | 'SERVICIO'; activo: boolean; controla_inventario: boolean; precio_venta: string
  unidad_medida: { nombre: string; codigo: string; activo: boolean; permite_decimales: boolean }
  impuestos: { id: string; tasa: string; activo: boolean }[]
}
export interface Customer {
  id: string; codigo: string; nombre: string; rfc: string | null; email: string | null
  telefono: string | null; activo: boolean; limite_credito: string; dias_credito: number
}
export interface Warehouse {
  id: string; codigo: string; nombre: string; activo: boolean
  sucursal: { id: string; empresa_id: string; codigo: string; nombre: string; activo: boolean }
}
export interface Stock {
  producto: { id: string; sku: string; nombre: string; activo: boolean }
  almacen_id: string; cantidad: string; reservado: string; disponible: string
  existencia_registrada: boolean; bajo_minimo: boolean
}
export interface PaymentMethod { id: string; codigo: string; nombre: string; activo: boolean; es_efectivo: boolean }
export interface CashRegister { id: string; sucursal_id: string; codigo: string; nombre: string; activo: boolean }
export interface CashSession {
  id: string; caja_id: string; usuario_apertura_id: string; estado: string
  fecha_cierre: string | null; monto_apertura: string
}
export interface CartLine { product: Product; quantity: string; discount: string }
export interface DraftPayment { key: number; methodId: string; amount: string; reference: string }
export interface SaleInput {
  empresa_id: string; sucursal_id: string; almacen_id: string; cliente_id: string | null
  sesion_caja_id: string | null; folio?: string; clave_idempotencia?: string; observaciones: string | null
  detalles: { producto_id: string; cantidad: string; descuento_porcentaje: string }[]
  pagos: { metodo_pago_id: string; monto: string; referencia: string | null }[]
}
export interface CreatedSale {
  id: string; folio: string; estado: string; condicion_pago: string
  subtotal: number; descuento: number; impuesto: number; total: number
}
