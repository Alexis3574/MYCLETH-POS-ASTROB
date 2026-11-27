export interface CashSessionRecord {
  id: string; caja_id: string; usuario_apertura_id: string; usuario_cierre_id: string | null
  fecha_apertura: string; fecha_cierre: string | null; estado: 'ABIERTA' | 'CERRADA'
  monto_apertura: string; monto_esperado: string | null; monto_cierre: string | null
  diferencia: string | null; notas: string | null
}
export interface CashSessionDetail extends CashSessionRecord {
  caja: { id: string; sucursal_id: string; codigo: string; activo: boolean }
  monto_esperado_actual: string
  resumen_movimientos: { tipo: 'ENTRADA' | 'SALIDA'; _sum: { monto: string | null } }[]
}
export interface CashMovement {
  id: string; sesion_caja_id: string; usuario_id: string; tipo: 'ENTRADA' | 'SALIDA'
  concepto: string; monto: string; referencia: string | null; fecha: string
}
export type CashAction =
  | { kind: 'open'; cashId: string; body: { monto_apertura: string; notas: string | null }; previousMaxId: string }
  | { kind: 'move'; cashId: string; sessionId: string; body: { tipo: 'ENTRADA' | 'SALIDA'; concepto: string; monto: string; referencia: string } }
  | { kind: 'close'; cashId: string; sessionId: string; body: { monto_cierre: string; notas: string | null } }
export interface CashAttempt { companyId: string; userId: string; action: CashAction }
