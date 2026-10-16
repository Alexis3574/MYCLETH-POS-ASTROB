import type { Prisma } from "../../../generated/prisma/client.js";

export type SaleTransaction = Prisma.TransactionClient;

export type DecimalInput = string | number;

export type InventoryMovementType =
  | "SALIDA"
  | "ENTRADA";

export type CashMovementType =
  | "ENTRADA"
  | "SALIDA";

export interface SaleDetailInput {
  productoId: bigint;
  descripcion?: string | null;
  cantidad: number;
  descuentoPorcentaje: number;
}

export interface SalePaymentInput {
  metodoPagoId: bigint;
  monto: number;
  referencia?: string | null;
}

export interface CreateSaleInput {
  empresaId: bigint;
  sucursalId: bigint;
  almacenId: bigint;
  clienteId?: bigint | null;
  usuarioId: bigint;
  sesionCajaId?: bigint | null;
  folio: string;
  observaciones?: string | null;
  ipOrigen?: string | null;
  detalles: SaleDetailInput[];
  pagos: SalePaymentInput[];
}

export interface CancelSaleInput {
  saleId: bigint;
  usuarioId: bigint;
  ipOrigen?: string | null;
}

export interface CreateSaleData {
  empresa_id: bigint;
  sucursal_id: bigint;
  almacen_id: bigint;
  cliente_id?: bigint | null;
  usuario_id: bigint;
  sesion_caja_id?: bigint | null;
  folio: string;
  condicion_pago: string;
  estado: string;
  subtotal: DecimalInput;
  descuento: DecimalInput;
  impuesto: DecimalInput;
  total: DecimalInput;
  observaciones?: string | null;
}

export interface CreateSaleDetailData {
  venta_id: bigint;
  producto_id: bigint;
  descripcion?: string | null;
  cantidad: DecimalInput;
  precio_unitario: DecimalInput;
  costo_unitario?: DecimalInput | null;
  descuento_porcentaje: DecimalInput;
  tasa_impuesto: DecimalInput;
  subtotal_linea: DecimalInput;
  descuento_importe: DecimalInput;
  impuesto_importe: DecimalInput;
  total_linea: DecimalInput;
}

export interface CreateSalePaymentData {
  venta_id: bigint;
  metodo_pago_id: bigint;
  sesion_caja_id?: bigint | null;
  monto: DecimalInput;
  referencia?: string | null;
}

export interface CreateCashMovementData {
  sesionCajaId: bigint;
  usuarioId: bigint;
  tipo: CashMovementType;
  concepto: string;
  monto: DecimalInput;
  referencia?: string | null;
}

export interface CreateInventoryMovementData {
  productoId: bigint;
  almacenId: bigint;
  usuarioId: bigint;
  tipo: InventoryMovementType;
  cantidad: DecimalInput;
  costoUnitario?: DecimalInput | null;
  ventaId: bigint;
  ventaDetalleId: bigint;
  motivo: string;
}
