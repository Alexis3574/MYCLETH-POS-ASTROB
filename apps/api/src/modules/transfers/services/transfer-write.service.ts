import { prisma } from "../../../lib/prisma.js";
import { transferRepository as transfers } from "../repositories/transfer.repository.js";
import { transferOperationRepository as operations } from "../repositories/transfer-operation.repository.js";
import { transferMovementRepository as movements } from "../repositories/transfer-movement.repository.js";
import { transferStockRepository as stocks } from "../repositories/transfer-stock.repository.js";
import { TransferError, retryableTransferError, transferNotFound, translateTransferError } from "../errors/transfer.errors.js";
import { requireDraft, validateTransferActor, validateTransferContext, validateTransferQuantity } from "../validators/transfer.validator.js";
import { createTransferContent, compareIds, decimalUnits, destinationAverage, orderedDetails, transferRequestHash } from "../utils/transfer-values.js";
import type { TransferAction } from "../utils/transfer-values.js";
import type { CreateTransferInput, StockState, TransferActor, TransferSnapshot, TransferStockChange, TransferTransaction } from "../types/transfer.types.js";
import { serializeTransfer, serializeTransferMovements, stockState } from "../utils/transfer.serializer.js";

async function replay(tx: TransferTransaction, actor: TransferActor, key: string, action: TransferAction, hash: string) {
  await validateTransferActor(tx, actor);
  await operations.lockKey(tx, actor.empresaId, key);
  const existing = await operations.findByKey(tx, actor.empresaId, key);
  if (!existing) return null;
  if (existing.accion !== action || existing.request_hash !== hash || existing.usuario_id !== actor.userId) {
    throw new TransferError(409, "TRANSFER_IDEMPOTENCY_CONFLICT", "La clave ya se utilizó con otro contenido, acción o usuario.", "Idempotency-Key");
  }
  return { replayed: true, data: existing.respuesta as unknown as TransferSnapshot };
}

async function snapshot(tx: TransferTransaction, actor: TransferActor, transferId: bigint, action: TransferAction, key: string,
  stockChanges: TransferStockChange[] = [], reason: string | null = null): Promise<TransferSnapshot> {
  const row = await transfers.find(tx, actor.empresaId, transferId);
  if (!row) throw transferNotFound();
  return { transferencia: serializeTransfer(row),
    operacion: { accion: action, clave_idempotencia: key, usuario_id: actor.userId.toString(), fecha: new Date().toISOString(), motivo: reason },
    movimientos: serializeTransferMovements(await movements.list(tx, actor.empresaId, transferId)),
    existencias: stockChanges, ecommerce: { eventos_creados: 0, politica: "SIN_EVENTOS_ALMACENES_PENDIENTES" } };
}

export async function createTransferInTransaction(tx: TransferTransaction, actor: TransferActor, input: CreateTransferInput, key: string) {
  const hash = transferRequestHash(actor.userId, "CREAR", null, createTransferContent(input));
  const previous = await replay(tx, actor, key, "CREAR", hash);
  if (previous) return previous;
  await validateTransferContext(tx, actor, input.almacen_origen_id, input.almacen_destino_id, input.detalles);
  const row = await transfers.create(tx, actor, input, key);
  const response = await snapshot(tx, actor, row.id, "CREAR", key);
  await operations.persist(tx, actor, row.id, "CREAR", key, hash, response);
  await operations.audit(tx, actor, response, null);
  return { replayed: false, data: response };
}

async function draft(tx: TransferTransaction, actor: TransferActor, id: bigint) {
  if (!await transfers.lock(tx, actor.empresaId, id)) throw transferNotFound();
  const row = await transfers.find(tx, actor.empresaId, id);
  if (!row) throw transferNotFound();
  requireDraft(row.estado);
  if (await movements.countAll(tx, id)) throw new TransferError(409, "TRANSFER_MOVEMENTS_EXIST", "La transferencia ya tiene movimientos registrados.");
  return row;
}

function verifyStockChange(before: StockState, after: StockState, delta: bigint, expectedCost: string): void {
  if (decimalUnits(after.cantidad) !== decimalUnits(before.cantidad) + delta || after.reservado !== before.reservado
    || decimalUnits(after.disponible) !== decimalUnits(after.cantidad) - decimalUnits(after.reservado)
    || after.costo_promedio !== expectedCost) {
    throw new TransferError(500, "TRANSFER_TRIGGER_UNEXPECTED_RESULT", "El trigger no produjo las cantidades y costos esperados; se revierte la operación.");
  }
}

export async function completeTransferInTransaction(tx: TransferTransaction, actor: TransferActor, id: bigint, key: string) {
  const hash = transferRequestHash(actor.userId, "COMPLETAR", id, {});
  const previous = await replay(tx, actor, key, "COMPLETAR", hash);
  if (previous) return previous;
  const row = await draft(tx, actor, id);
  const details = orderedDetails(row.transferencia_detalle.map((item) => ({ id: item.id, producto_id: item.producto_id, cantidad: item.cantidad.toFixed(3) })));
  const products = await validateTransferContext(tx, actor, row.almacen_origen_id, row.almacen_destino_id, details);
  const before = new Map<bigint, { origin: StockState; destination: StockState }>();
  for (const item of details) {
    await stocks.ensureDestination(tx, item.producto_id, row.almacen_destino_id);
    const states = new Map<bigint, StockState>();
    for (const warehouseId of [row.almacen_origen_id, row.almacen_destino_id].sort(compareIds)) {
      states.set(warehouseId, stockState(await stocks.lock(tx, actor.empresaId, item.producto_id, warehouseId)));
    }
    const origin = states.get(row.almacen_origen_id)!;
    const destination = states.get(row.almacen_destino_id)!;
    validateTransferQuantity(item.cantidad, products.get(item.producto_id)!.unidad_medida.permite_decimales, origin, destination);
    before.set(item.producto_id, { origin, destination });
  }

  await movements.complete(tx, id, actor.userId);
  const moved = await movements.list(tx, actor.empresaId, id);
  if (moved.length !== details.length * 2) throw new TransferError(500, "TRANSFER_MOVEMENT_INVARIANT", "Faltan movimientos de la transferencia; se revierte la operación.");
  const changes: TransferStockChange[] = [];
  for (const item of details) {
    const initial = before.get(item.producto_id)!;
    const pair = moved.filter((movement) => movement.documento_detalle_id === item.id && movement.producto_id === item.producto_id);
    const out = pair.find((movement) => movement.tipo === "TRANSFERENCIA_SALIDA" && movement.almacen_id === row.almacen_origen_id);
    const incoming = pair.find((movement) => movement.tipo === "TRANSFERENCIA_ENTRADA" && movement.almacen_id === row.almacen_destino_id);
    if (pair.length !== 2 || !out || !incoming || out.usuario_id !== actor.userId || incoming.usuario_id !== actor.userId
      || out.cantidad.toFixed(3) !== item.cantidad || incoming.cantidad.toFixed(3) !== item.cantidad
      || out.costo_unitario?.toFixed(4) !== initial.origin.costo_promedio || incoming.costo_unitario?.toFixed(4) !== initial.origin.costo_promedio) {
      throw new TransferError(500, "TRANSFER_MOVEMENT_INVARIANT", "Los movimientos no coinciden con los productos, cantidades y costos; se revierte la operación.");
    }
    const origin = stockState(await stocks.lock(tx, actor.empresaId, item.producto_id, row.almacen_origen_id));
    const destination = stockState(await stocks.lock(tx, actor.empresaId, item.producto_id, row.almacen_destino_id));
    verifyStockChange(initial.origin, origin, -decimalUnits(item.cantidad), initial.origin.costo_promedio);
    verifyStockChange(initial.destination, destination, decimalUnits(item.cantidad), destinationAverage(initial.destination, item.cantidad, initial.origin.costo_promedio));
    changes.push({ producto_id: item.producto_id.toString(), cantidad: item.cantidad, costo_unitario: initial.origin.costo_promedio,
      origen: { almacen_id: row.almacen_origen_id.toString(), antes: initial.origin, despues: origin },
      destino: { almacen_id: row.almacen_destino_id.toString(), antes: initial.destination, despues: destination } });
  }
  const response = await snapshot(tx, actor, id, "COMPLETAR", key, changes);
  if (response.transferencia.estado !== "COMPLETADA") throw new TransferError(500, "TRANSFER_STATE_INVARIANT", "El procedimiento no completó el documento; se revierte la operación.");
  await operations.persist(tx, actor, id, "COMPLETAR", key, hash, response);
  await operations.audit(tx, actor, response, serializeTransfer(row));
  return { replayed: false, data: response };
}

export async function cancelTransferInTransaction(tx: TransferTransaction, actor: TransferActor, id: bigint, key: string, reason: string) {
  const hash = transferRequestHash(actor.userId, "CANCELAR", id, { motivo: reason });
  const previous = await replay(tx, actor, key, "CANCELAR", hash);
  if (previous) return previous;
  const row = await draft(tx, actor, id);
  const result = await transfers.cancel(tx, actor.empresaId, id);
  if (result.count !== 1) throw new TransferError(409, "TRANSFER_INVALID_STATE", "No se pudo cancelar el borrador.");
  const response = await snapshot(tx, actor, id, "CANCELAR", key, [], reason);
  await operations.persist(tx, actor, id, "CANCELAR", key, hash, response);
  await operations.audit(tx, actor, response, serializeTransfer(row));
  return { replayed: false, data: response };
}

async function write<T>(operation: (tx: TransferTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 20000 });
    } catch (error) {
      if (retryableTransferError(error) && attempt < 2) continue;
      throw translateTransferError(error);
    }
  }
  throw new Error("No se completó la transacción.");
}

export const transferWriteService = {
  create: (actor: TransferActor, input: CreateTransferInput, key: string) => write((tx) => createTransferInTransaction(tx, actor, input, key)),
  complete: (actor: TransferActor, id: bigint, key: string) => write((tx) => completeTransferInTransaction(tx, actor, id, key)),
  cancel: (actor: TransferActor, id: bigint, key: string, reason: string) => write((tx) => cancelTransferInTransaction(tx, actor, id, key, reason)),
};
