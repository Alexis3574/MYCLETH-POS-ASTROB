import type { Prisma } from "../../../generated/prisma/client.js";
import type { AdjustmentInput, AdjustmentSnapshot, InventoryActor, InventoryTransaction } from "../types/inventory.types.js";

export const inventoryAdjustmentRepository = {
  async lockKey(tx: InventoryTransaction, empresaId: bigint, key: string) {
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`inventory-adjustment:${empresaId}:${key}`}, 0))
    `;
  },
  findByKey(tx: InventoryTransaction, empresaId: bigint, key: string) {
    return tx.ajuste_inventario.findUnique({
      where: { empresa_id_clave_idempotencia: { empresa_id: empresaId, clave_idempotencia: key } },
    });
  },
  async nextId(tx: InventoryTransaction) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT nextval(pg_get_serial_sequence('pos.ajuste_inventario', 'id')) AS id
    `;
    if (!rows[0]) throw new Error("No se pudo reservar el ID del ajuste.");
    return rows[0].id;
  },
  persist(tx: InventoryTransaction, actor: InventoryActor, input: AdjustmentInput, key: string, hash: string, snapshot: AdjustmentSnapshot) {
    return tx.ajuste_inventario.create({ data: {
      id: BigInt(snapshot.ajuste_id), empresa_id: actor.empresaId, usuario_id: actor.userId,
      almacen_id: input.almacen_id, producto_id: input.producto_id, clave_idempotencia: key,
      request_hash: hash, tipo: input.tipo, cantidad: input.cantidad, costo_unitario: input.costo_unitario,
      motivo: input.motivo, sincronizar_ecommerce: input.sincronizar_ecommerce,
      movimiento_inventario_id: BigInt(snapshot.movimiento_id),
      respuesta: snapshot as unknown as Prisma.InputJsonValue,
    } });
  },
  audit(tx: InventoryTransaction, actor: InventoryActor, snapshot: AdjustmentSnapshot) {
    return tx.auditoria.create({ data: {
      usuario_id: actor.userId, tabla: "ajuste_inventario", registro_id: BigInt(snapshot.ajuste_id), accion: "INSERT",
      datos_anteriores: snapshot.existencia_antes,
      datos_nuevos: snapshot as unknown as Prisma.InputJsonValue,
    } });
  },
};
