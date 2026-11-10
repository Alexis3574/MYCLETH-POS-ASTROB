export interface SalesQuery {
  page: number
  limit: number
  folio: string
  fecha_desde: string
  fecha_hasta: string
  estado: string
  condicion_pago: string
}
export type SalesFilterValues = Omit<SalesQuery, 'page' | 'limit'>
export interface SaleLocation { id: string; codigo: string; nombre: string }
export interface SaleCustomer extends SaleLocation { email?: string | null; telefono?: string | null }
export interface SaleUser { id: string; username: string; nombre: string; apellido: string | null }
export interface SaleListItem {
  id: string
  folio: string
  fecha: string
  estado: string
  condicion_pago: string
  subtotal: number
  descuento: number
  impuesto: number
  total: number
  sucursal: SaleLocation
  almacen: SaleLocation
  cliente: SaleCustomer | null
  usuario: SaleUser
}
export interface SalesPagination { page: number; limit: number; total: number; totalPages: number }
export interface SalesResponse { ok: true; data: SaleListItem[]; pagination: SalesPagination }
export interface SalePaymentMethod { id: string; codigo: string; nombre: string; es_efectivo: boolean }
export interface SaleItem {
  id: string
  producto_id: string
  descripcion: string | null
  cantidad: number
  precio_unitario: number
  descuento_porcentaje: number
  tasa_impuesto: number
  subtotal_linea: number
  descuento_importe: number
  impuesto_importe: number
  total_linea: number
  producto: { id: string; sku: string; codigo_barras: string | null; nombre: string }
}
export interface SalePayment {
  id: string
  monto: number
  referencia: string | null
  fecha: string
  metodo_pago: SalePaymentMethod
}
export interface SaleDetailData extends SaleListItem {
  observaciones: string | null
  empresa: { id: string; nombre: string }
  detalles: SaleItem[]
  pagos: SalePayment[]
  devoluciones: { tiene_devoluciones: boolean; total_devoluciones: number; total_devuelto: number }
  sesion_caja: null | {
    id: string
    estado: string
    fecha_apertura: string
    fecha_cierre: string | null
    caja: SaleLocation
  }
}
export interface SaleFinancialData {
  venta: { id: string; folio: string; fecha: string; estado: string; condicion_pago: string }
  resumen: {
    total_venta: number
    total_pagos_registrados: number
    total_devuelto: number
    total_revertido_cancelacion: number
    total_neto_venta: number
    total_neto_pagos: number
    estado_financiero: string
  }
  metodos_pago: {
    metodo_pago: SalePaymentMethod
    monto_original: number
    monto_devuelto: number
    monto_revertido_cancelacion: number
    monto_neto: number
  }[]
  efectivo: { ingresado: number; devuelto: number; revertido_cancelacion: number; neto: number }
  credito: null | {
    monto_original: number
    monto_devuelto: number
    monto_neto_post_devoluciones: number
    cliente: (SaleCustomer & { limite_credito: number; dias_credito: number }) | null
    cuentas_por_cobrar_integrado: boolean
  }
}
