import { prisma } from "../../../lib/prisma.js";
import { inventorySyncRepository } from "../../inventory-sync/inventory-sync.repository.js";
import { inventoryAdjustmentRepository as adjustments } from "../repositories/inventory-adjustment.repository.js";
import { inventoryMovementRepository as movements } from "../repositories/inventory-movement.repository.js";
import { inventoryStockRepository as stocks } from "../repositories/inventory-stock.repository.js";
import { InventoryError, errorCode } from "../errors/inventory.errors.js";
import type { AdjustmentInput, AdjustmentSnapshot, InventoryActor, InventoryTransaction } from "../types/inventory.types.js";
import { validateActor, validateAdjustmentContext } from "../validators/inventory-context.validator.js";
import { validateAdjustmentQuantity } from "../validators/inventory-adjustment.validator.js";
import { adjustmentHash, adjustmentOperationId, decimalUnits } from "../utils/inventory-values.js";
import { stockState } from "../utils/inventory.serializer.js";

export async function adjustInTransaction(tx: InventoryTransaction, actor: InventoryActor, input: AdjustmentInput, key: string) {
  await validateActor(tx, actor);
  await adjustments.lockKey(tx, actor.empresaId, key);
  const hash = adjustmentHash(actor.userId, input);
  const existing = await adjustments.findByKey(tx, actor.empresaId, key);
  if (existing) {
    if (existing.request_hash !== hash) {
      throw new InventoryError(409, "INVENTORY_IDEMPOTENCY_CONFLICT", "La clave de idempotencia ya se utilizó con otro contenido o usuario.", "Idempotency-Key");
    }
    return { replayed: true, data: existing.respuesta as unknown as AdjustmentSnapshot };
  }

  const { product } = await validateAdjustmentContext(tx, actor, input.almacen_id, input.producto_id);
  const before = stockState(await stocks.lock(tx, actor.empresaId, input.producto_id, input.almacen_id));
  validateAdjustmentQuantity(input, product, before);
  const ajusteId = await adjustments.nextId(tx);
  // Insertar el movimiento hace que el trigger aplique stock una única vez.
  const movement = await movements.createAdjustmentMovement(tx, actor, input, ajusteId);
  const sync = input.sincronizar_ecommerce ? await inventorySyncRepository.createPending({
    movimientoInventarioId: movement.id,
    operationId: adjustmentOperationId(actor.empresaId, ajusteId, input.tipo),
    codigoBarras: product.codigo_barras, sku: product.sku,
    adjustment: Number(decimalUnits(input.cantidad) / 1000n) * (input.tipo === "AJUSTE_POSITIVO" ? 1 : -1),
  }, tx) : null;

  const afterRow = await stocks.find(tx, input.producto_id, input.almacen_id);
  if (!afterRow) throw new InventoryError(500, "INVENTORY_TRIGGER_NOT_APPLIED", "El movimiento no generó una existencia.");
  const after = stockState({
    cantidad: afterRow.cantidad.toFixed(3), reservado: afterRow.reservado.toFixed(3),
    disponible: afterRow.disponible?.toFixed(3) ?? null, costo_promedio: afterRow.costo_promedio.toFixed(4),
  });
  const expected = decimalUnits(before.cantidad) + decimalUnits(input.cantidad) * (input.tipo === "AJUSTE_POSITIVO" ? 1n : -1n);
  if (decimalUnits(after.cantidad) !== expected || after.reservado !== before.reservado) {
    throw new InventoryError(500, "INVENTORY_TRIGGER_UNEXPECTED_RESULT", "El trigger no produjo el resultado esperado; se revierte el ajuste.");
  }
  const snapshot: AdjustmentSnapshot = {
    ajuste_id: ajusteId.toString(), empresa_id: actor.empresaId.toString(), almacen_id: input.almacen_id.toString(),
    producto_id: input.producto_id.toString(), usuario_id: actor.userId.toString(), clave_idempotencia: key,
    tipo: input.tipo, cantidad: input.cantidad, costo_unitario: input.costo_unitario,
    motivo: input.motivo, fecha: movement.fecha.toISOString(), movimiento_id: movement.id.toString(),
    existencia_antes: before, existencia_despues: after,
    sincronizacion: { solicitada: input.sincronizar_ecommerce, evento_id: sync?.id.toString() ?? null,
      operation_id: sync?.operation_id ?? null, estado_al_crear: sync?.estado ?? null },
  };
  await adjustments.persist(tx, actor, input, key, hash, snapshot);
  await adjustments.audit(tx, actor, snapshot);
  return { replayed: false, data: snapshot };
}

export const inventoryAdjustmentService = {
  async create(actor: InventoryActor, input: AdjustmentInput, key: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await prisma.$transaction((tx) => adjustInTransaction(tx, actor, input, key), {
          isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000,
        });
      } catch (error) {
        if (errorCode(error) !== "P2034") throw error;
        if (attempt === 2) throw new InventoryError(409, "INVENTORY_CONCURRENT_CHANGE", "Cambio concurrente; reintente con la misma clave de idempotencia.");
      }
    }
    throw new Error("No se completó la transacción.");
  },
};
