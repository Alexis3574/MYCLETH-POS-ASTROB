import type { Prisma } from "../../../generated/prisma/client.js";
import type { AdjustmentInput, InventoryActor, InventoryTransaction, MovementsQuery } from "../types/inventory.types.js";

export const movementInclude = {
  producto: { select: { id: true, sku: true, codigo_barras: true, nombre: true } },
  almacen: { select: { id: true, codigo: true, nombre: true, sucursal_id: true } },
  sincronizacion_ecommerce_inventario: { select: { id: true, operation_id: true, adjustment: true, estado: true, intentos: true, sincronizado_en: true } },
} satisfies Prisma.movimiento_inventarioInclude;
export type MovementRecord = Prisma.movimiento_inventarioGetPayload<{ include: typeof movementInclude }>;

export const inventoryMovementRepository = {
  async list(tx: InventoryTransaction, empresaId: bigint, query: MovementsQuery) {
    // Se verifican ambas pertenencias aunque existan datos antiguos inconsistentes.
    const where: Prisma.movimiento_inventarioWhereInput = {
      producto: { empresa_id: empresaId }, almacen: { sucursal: { empresa_id: empresaId } },
    };
    if (query.almacen_id !== undefined) where.almacen_id = query.almacen_id;
    if (query.producto_id !== undefined) where.producto_id = query.producto_id;
    if (query.tipo !== undefined) where.tipo = query.tipo;
    if (query.documento_tipo !== undefined) where.documento_tipo = query.documento_tipo;
    if (query.documento_id !== undefined) where.documento_id = query.documento_id;
    if (query.fecha_desde !== undefined || query.fecha_hasta !== undefined) {
      where.fecha = { gte: query.fecha_desde, lte: query.fecha_hasta };
    }
    const total = await tx.movimiento_inventario.count({ where });
    const rows = await tx.movimiento_inventario.findMany({
      where, include: movementInclude, orderBy: [{ fecha: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit, take: query.limit,
    });
    return { total, rows };
  },
  createAdjustmentMovement(tx: InventoryTransaction, actor: InventoryActor, input: AdjustmentInput, ajusteId: bigint) {
    return tx.movimiento_inventario.create({ data: {
      producto_id: input.producto_id, almacen_id: input.almacen_id, usuario_id: actor.userId,
      tipo: input.tipo, cantidad: input.cantidad, costo_unitario: input.costo_unitario,
      documento_tipo: "AJUSTE_INVENTARIO", documento_id: ajusteId, documento_detalle_id: ajusteId,
      motivo: input.motivo,
    } });
  },
};
