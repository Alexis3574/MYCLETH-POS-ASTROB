export interface DashboardFilters {
  fecha_desde?: string
  fecha_hasta?: string
  sucursal_id?: string
}

export interface DashboardPeriod {
  fecha_desde: string
  fecha_hasta: string
  zona_horaria: string
  moneda: string | null
}

export interface DashboardDailyTrend {
  fecha: string
  ventas_brutas: string
  devoluciones: string
  ventas_netas: string
}

export interface DashboardSales {
  operaciones: number
  devoluciones_registradas: number
  ventas_brutas: string
  monto_devuelto: string
  ventas_netas: string
  ticket_promedio: string
  tendencia_diaria: DashboardDailyTrend[]
}

export interface DashboardCash {
  cajas_activas: number
  sesiones_abiertas: number
}

export interface DashboardInventory {
  existencias_registradas: number
  bajo_minimo: number
  agotadas: number
}

export interface DashboardEcommerce {
  pendientes_o_error: number
}

export interface DashboardIndicators {
  ventas?: DashboardSales
  caja?: DashboardCash
  inventario?: DashboardInventory
  ecommerce?: DashboardEcommerce
}

export interface DashboardSummary {
  periodo: DashboardPeriod
  sucursal_id: string | null
  indicadores: DashboardIndicators
}

export interface DashboardSummaryResponse {
  ok: true
  data: DashboardSummary
}
