import type { Prisma } from "../../../generated/prisma/client.js";
import type { z } from "zod";
import type { createTransferSchema, transferQuerySchema } from "../transfer.schema.js";
import type { TransferAction } from "../utils/transfer-values.js";
import type { serializeTransfer } from "../utils/transfer.serializer.js";

export type TransferTransaction = Prisma.TransactionClient;
export type CreateTransferInput = z.infer<typeof createTransferSchema>;
export type TransferQuery = z.infer<typeof transferQuerySchema>;
export interface TransferActor { empresaId: bigint; userId: bigint }
export interface StockState { cantidad: string; reservado: string; disponible: string; costo_promedio: string }
export interface TransferStockChange {
  producto_id: string; cantidad: string; costo_unitario: string;
  origen: { almacen_id: string; antes: StockState; despues: StockState };
  destino: { almacen_id: string; antes: StockState; despues: StockState };
}
export interface TransferSnapshot {
  transferencia: ReturnType<typeof serializeTransfer>;
  operacion: { accion: TransferAction; clave_idempotencia: string; usuario_id: string; fecha: string; motivo: string | null };
  movimientos: Array<{ id: string; producto_id: string; almacen_id: string; tipo: string;
    cantidad: string; costo_unitario: string | null; documento_detalle_id: string | null; fecha: string }>;
  existencias: TransferStockChange[];
  ecommerce: { eventos_creados: 0; politica: "SIN_EVENTOS_ALMACENES_PENDIENTES" };
}
