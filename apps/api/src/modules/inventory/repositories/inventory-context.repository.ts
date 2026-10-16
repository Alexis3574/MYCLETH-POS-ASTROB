import type { Prisma } from "../../../generated/prisma/client.js";
import type { InventoryTransaction, WarehousesQuery } from "../types/inventory.types.js";

export const inventoryContextRepository = {
  async listWarehouses(tx: InventoryTransaction, empresaId: bigint, query: WarehousesQuery) {
    const where: Prisma.almacenWhereInput = { sucursal: { empresa_id: empresaId } };
    if (query.activo !== undefined) where.activo = query.activo;
    if (query.search !== undefined) where.OR = [
      { nombre: { contains: query.search, mode: "insensitive" } },
      { codigo: { contains: query.search, mode: "insensitive" } },
    ];
    const total = await tx.almacen.count({ where });
    const rows = await tx.almacen.findMany({ where,
      select: { id: true, codigo: true, nombre: true, activo: true,
        sucursal: { select: { id: true, codigo: true, nombre: true, activo: true, empresa_id: true } } },
      orderBy: [{ nombre: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit,
    });
    return { total, rows };
  },
  findWarehouse(tx: InventoryTransaction, empresaId: bigint, id: bigint) {
    return tx.almacen.findFirst({
      where: { id, sucursal: { empresa_id: empresaId } },
      select: { id: true, codigo: true, nombre: true, activo: true,
        sucursal: { select: { id: true, codigo: true, nombre: true, activo: true, empresa_id: true } } },
    });
  },
  findProduct(tx: InventoryTransaction, empresaId: bigint, id: bigint) {
    return tx.producto.findFirst({
      where: { id, empresa_id: empresaId },
      select: { id: true, empresa_id: true, sku: true, codigo_barras: true, nombre: true,
        activo: true, tipo: true, controla_inventario: true, costo_referencia: true,
        unidad_medida: { select: { activo: true, permite_decimales: true } } },
    });
  },
  findActor(tx: InventoryTransaction, empresaId: bigint, userId: bigint) {
    return tx.usuario.findFirst({
      where: { id: userId, empresa_id: empresaId, activo: true, bloqueado: false, empresa: { activo: true } },
      select: { id: true },
    });
  },
  async lockWarehouse(tx: InventoryTransaction, empresaId: bigint, id: bigint) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT a.id FROM pos.almacen a
      JOIN pos.sucursal s ON s.id = a.sucursal_id
      WHERE a.id = ${id} AND s.empresa_id = ${empresaId}
      FOR SHARE OF a, s
    `;
    return rows.length > 0;
  },
  async lockProduct(tx: InventoryTransaction, empresaId: bigint, id: bigint) {
    // También serializa dos entradas a una existencia que aún no tiene fila.
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT p.id FROM pos.producto p
      JOIN pos.unidad_medida u ON u.id = p.unidad_medida_id
      WHERE p.id = ${id} AND p.empresa_id = ${empresaId}
      FOR UPDATE OF p FOR SHARE OF u
    `;
    return rows.length > 0;
  },
};
