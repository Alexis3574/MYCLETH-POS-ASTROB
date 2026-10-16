import type { Prisma } from "../../../generated/prisma/client.js";
import type { InventoryTransaction, LockedStock, StockQuery } from "../types/inventory.types.js";

const stockProductSelect = {
  id: true, sku: true, codigo_barras: true, nombre: true, activo: true,
  stock_minimo: true, stock_maximo: true,
  unidad_medida: { select: { id: true, codigo: true, nombre: true, permite_decimales: true } },
} satisfies Prisma.productoSelect;

export type StockProduct = Prisma.productoGetPayload<{ select: typeof stockProductSelect }>;
export type StockRecord = StockProduct & { existencia: Prisma.existenciaGetPayload<{}>[] };

export const inventoryStockRepository = {
  async list(tx: InventoryTransaction, empresaId: bigint, query: StockQuery) {
    const where: Prisma.productoWhereInput = { empresa_id: empresaId, controla_inventario: true };
    if (query.producto_id !== undefined) where.id = query.producto_id;
    if (query.activo !== undefined) where.activo = query.activo;
    if (query.search !== undefined) {
      where.OR = [
        { nombre: { contains: query.search, mode: "insensitive" } },
        { sku: { contains: query.search, mode: "insensitive" } },
        { codigo_barras: { contains: query.search, mode: "insensitive" } },
      ];
    }
    const total = await tx.producto.count({ where });
    const rows = await tx.producto.findMany({
      where, select: { ...stockProductSelect, existencia: { where: { almacen_id: query.almacen_id } } },
      orderBy: [{ nombre: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit, take: query.limit,
    });
    return { total, rows };
  },
  find(tx: InventoryTransaction, productoId: bigint, almacenId: bigint) {
    return tx.existencia.findUnique({ where: { producto_id_almacen_id: { producto_id: productoId, almacen_id: almacenId } } });
  },
  async lock(tx: InventoryTransaction, empresaId: bigint, productoId: bigint, almacenId: bigint) {
    const rows = await tx.$queryRaw<LockedStock[]>`
      SELECT e.cantidad::text AS cantidad, e.reservado::text AS reservado,
             e.disponible::text AS disponible, e.costo_promedio::text AS costo_promedio
      FROM pos.existencia e
      JOIN pos.producto p ON p.id = e.producto_id
      JOIN pos.almacen a ON a.id = e.almacen_id
      JOIN pos.sucursal s ON s.id = a.sucursal_id
      WHERE e.producto_id = ${productoId} AND e.almacen_id = ${almacenId}
        AND p.empresa_id = ${empresaId} AND s.empresa_id = ${empresaId}
      FOR UPDATE OF e
    `;
    return rows[0] ?? null;
  },
};
