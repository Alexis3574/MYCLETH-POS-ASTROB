import type { Prisma } from "../../../generated/prisma/client.js";
import type { z } from "zod";
import type { createAdjustmentSchema, stockQuerySchema, movementsQuerySchema, kardexQuerySchema, warehousesQuerySchema } from "../inventory.schema.js";

export type InventoryTransaction = Prisma.TransactionClient;
export type AdjustmentInput = z.infer<typeof createAdjustmentSchema>;
export type StockQuery = z.infer<typeof stockQuerySchema>;
export type MovementsQuery = z.infer<typeof movementsQuerySchema>;
export type KardexQuery = z.infer<typeof kardexQuerySchema>;
export type WarehousesQuery = z.infer<typeof warehousesQuerySchema>;
export interface InventoryActor { empresaId: bigint; userId: bigint }
export interface LockedStock {
  cantidad: string; reservado: string; disponible: string | null; costo_promedio: string;
}
export interface AdjustmentSnapshot {
  ajuste_id: string; empresa_id: string; almacen_id: string; producto_id: string; usuario_id: string;
  clave_idempotencia: string; tipo: AdjustmentInput["tipo"]; cantidad: string;
  costo_unitario: string | null; motivo: string; fecha: string;
  movimiento_id: string;
  existencia_antes: { cantidad: string; reservado: string; disponible: string; costo_promedio: string };
  existencia_despues: { cantidad: string; reservado: string; disponible: string; costo_promedio: string };
  sincronizacion: { solicitada: boolean; evento_id: string | null; operation_id: string | null; estado_al_crear: string | null };
}
