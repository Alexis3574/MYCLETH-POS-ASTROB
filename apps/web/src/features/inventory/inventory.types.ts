import type { Warehouse } from '../commercial/commercial.types'
export interface InventoryState { cantidad: string; reservado: string; disponible: string; costo_promedio: string }
export interface InventoryStock extends InventoryState {
  producto: { id: string; sku: string; codigo_barras: string | null; nombre: string; activo: boolean }
  almacen_id: string; existencia_registrada: boolean; stock_minimo: string; stock_maximo: string | null; bajo_minimo: boolean
  unidad: { id: string; codigo: string; nombre: string; permite_decimales: boolean }; actualizado_en: string | null
}
export type MovementType = 'ENTRADA' | 'SALIDA' | 'AJUSTE_POSITIVO' | 'AJUSTE_NEGATIVO' | 'TRANSFERENCIA_ENTRADA' | 'TRANSFERENCIA_SALIDA'
export interface InventoryMovement {
  id: string; tipo: MovementType; cantidad: string; costo_unitario: string | null; documento_tipo: string | null; documento_id: string | null
  documento_detalle_id: string | null; usuario_id: string | null; motivo: string | null; fecha: string
  producto: { id: string; nombre: string; sku: string }; almacen: { id: string; codigo: string; nombre: string; sucursal_id: string }
  sincronizacion: { id: string; operation_id: string; adjustment: number; estado: string; intentos: number; sincronizado_en: string | null } | null
}
export interface KardexRow extends Pick<InventoryMovement, 'id' | 'tipo' | 'cantidad' | 'costo_unitario' | 'documento_tipo' | 'documento_id' | 'documento_detalle_id' | 'usuario_id' | 'motivo' | 'fecha'> { delta: string; saldo_antes: string; saldo_despues: string }
export interface KardexData {
  producto: { id: string; nombre: string; sku: string }; almacen: { id: string; nombre: string; codigo: string }
  periodo: { fecha_desde: string | null; fecha_hasta: string | null }
  resumen: { metodo_saldo: 'RECONSTRUIDO_DESDE_EXISTENCIA_ACTUAL'; saldo_base_reconstruido: string; saldo_inicial_periodo: string; entradas_periodo: string; salidas_periodo: string; saldo_final_periodo: string }
  existencia_actual: InventoryState & { existencia_registrada: boolean }; rows: KardexRow[]; page: number; size: number; total: number
}
export interface AdjustmentInput { almacen_id: string; producto_id: string; tipo: 'AJUSTE_POSITIVO' | 'AJUSTE_NEGATIVO'; cantidad: string; costo_unitario: string | null; motivo: string; sincronizar_ecommerce: boolean }
export interface AdjustmentResult extends Omit<AdjustmentInput, 'sincronizar_ecommerce'> {
  ajuste_id: string; empresa_id: string; usuario_id: string; clave_idempotencia: string; fecha: string; movimiento_id: string
  existencia_antes: InventoryState; existencia_despues: InventoryState
  sincronizacion: { solicitada: boolean; evento_id: string | null; operation_id: string | null; estado_al_crear: string | null }
}
export interface TransferInput { almacen_origen_id: string; almacen_destino_id: string; folio?: string; observaciones: string | null; detalles: { producto_id: string; cantidad: string }[] }
export interface TransferSummary {
  id: string; empresa_id: string; usuario_id: string; folio: string; estado: 'BORRADOR' | 'COMPLETADA' | 'CANCELADA'; fecha: string; observaciones: string | null
  almacen_origen: Warehouse; almacen_destino: Warehouse; total_productos: number
}
export interface TransferRecord extends TransferSummary {
  detalles: { id: string; producto_id: string; cantidad: string; producto: { id: string; nombre: string; sku: string; activo: boolean; unidad: { permite_decimales: boolean } } }[]
}
export interface TransferMovement { id: string; producto_id: string; almacen_id: string; tipo: string; cantidad: string; costo_unitario: string | null; documento_detalle_id: string | null; fecha: string }
export interface TransferDetail extends TransferRecord { movimientos: TransferMovement[]; operaciones: { id: string; usuario_id: string; accion: string; fecha: string }[] }
export type InventoryAction = { kind: 'adjust'; body: AdjustmentInput } | { kind: 'create-transfer'; body: TransferInput } | { kind: 'complete-transfer'; id: string; body: Record<string, never> } | { kind: 'cancel-transfer'; id: string; body: { motivo: string } }
export interface InventoryAttempt { companyId: string; userId: string; key: string; action: InventoryAction }
export type InventoryResult = { kind: 'adjust'; adjustment: AdjustmentResult } | { kind: 'transfer'; transfer: TransferRecord }
