import { prisma } from "../../../lib/prisma.js";
import { inventoryContextRepository } from "../repositories/inventory-context.repository.js";
import { inventoryStockRepository } from "../repositories/inventory-stock.repository.js";
import { inventoryMovementRepository } from "../repositories/inventory-movement.repository.js";
import { inventoryKardexRepository } from "../repositories/inventory-kardex.repository.js";
import type { InventoryTransaction, StockQuery, MovementsQuery, KardexQuery, WarehousesQuery } from "../types/inventory.types.js";
import { validateReadProduct, validateReadWarehouse, validateAuthorizedWarehouse } from "../validators/inventory-context.validator.js";
import { loadBranchAccess } from "../authorization/branch-access.js";
import type { InventoryActor } from "../types/inventory.types.js";
import { countToNumber, pagination, serializeKardexRow, serializeMovement, serializeStock, stockState } from "../utils/inventory.serializer.js";
import { formatSignedDecimal } from "../utils/inventory-values.js";

function read<T>(operation: (tx: InventoryTransaction) => Promise<T>) {
  return prisma.$transaction(operation, { isolationLevel: "RepeatableRead", timeout: 15000 });
}

export async function getKardexInTransaction(tx: InventoryTransaction, empresaId: bigint, query: KardexQuery) {
  const warehouse = await validateReadWarehouse(tx, empresaId, query.almacen_id);
  const product = await validateReadProduct(tx, empresaId, query.producto_id, true);
  const stock = await inventoryStockRepository.find(tx, query.producto_id, query.almacen_id);
  const current = stockState(stock ? {
    cantidad: stock.cantidad.toFixed(3), reservado: stock.reservado.toFixed(3),
    disponible: stock.disponible?.toFixed(3) ?? null, costo_promedio: stock.costo_promedio.toFixed(4),
  } : null);
  const summary = await inventoryKardexRepository.summary(tx, empresaId, query);
  const rows = await inventoryKardexRepository.rows(tx, empresaId, query);
  return {
    producto: { id: product.id.toString(), sku: product.sku, nombre: product.nombre },
    almacen: { id: warehouse.id.toString(), codigo: warehouse.codigo, nombre: warehouse.nombre },
    periodo: { fecha_desde: query.fecha_desde?.toISOString() ?? null, fecha_hasta: query.fecha_hasta?.toISOString() ?? null },
    resumen: {
      metodo_saldo: "RECONSTRUIDO_DESDE_EXISTENCIA_ACTUAL",
      saldo_base_reconstruido: formatSignedDecimal(summary.saldo_base, 3),
      saldo_inicial_periodo: formatSignedDecimal(summary.saldo_inicial, 3),
      entradas_periodo: formatSignedDecimal(summary.entradas, 3),
      salidas_periodo: formatSignedDecimal(summary.salidas, 3),
      saldo_final_periodo: formatSignedDecimal(summary.saldo_final, 3),
    },
    existencia_actual: { ...current, existencia_registrada: Boolean(stock) },
    data: rows.map(serializeKardexRow), pagination: pagination(query.page, query.limit, countToNumber(summary.total)),
  };
}

export const inventoryQueryService = {
  warehouses(actor: InventoryActor, query: WarehousesQuery) {
    return read(async (tx) => {
      const access = await loadBranchAccess(tx, actor);
      const result = await inventoryContextRepository.listWarehouses(tx, access, query);
      return { data: result.rows.map((row) => ({ ...row, id: row.id.toString(),
        sucursal: { ...row.sucursal, id: row.sucursal.id.toString(), empresa_id: row.sucursal.empresa_id.toString() } })),
        pagination: pagination(query.page, query.limit, result.total) };
    });
  },
  stock(actor: InventoryActor, query: StockQuery) {
    return read(async (tx) => {
      const access = await loadBranchAccess(tx, actor);
      const warehouse = await validateAuthorizedWarehouse(tx, access, query.almacen_id);
      if (query.producto_id !== undefined) await validateReadProduct(tx, actor.empresaId, query.producto_id, true);
      const result = await inventoryStockRepository.list(tx, actor.empresaId, query);
      return { almacen: { id: warehouse.id.toString(), codigo: warehouse.codigo, nombre: warehouse.nombre, activo: warehouse.activo },
        data: result.rows.map((row) => serializeStock(row, query.almacen_id)), pagination: pagination(query.page, query.limit, result.total) };
    });
  },
  movements(actor: InventoryActor, query: MovementsQuery) {
    return read(async (tx) => {
      const access = await loadBranchAccess(tx, actor);
      if (query.almacen_id !== undefined) await validateAuthorizedWarehouse(tx, access, query.almacen_id);
      if (query.producto_id !== undefined) await validateReadProduct(tx, actor.empresaId, query.producto_id);
      const result = await inventoryMovementRepository.list(tx, actor.empresaId, query, access);
      return { data: result.rows.map(serializeMovement), pagination: pagination(query.page, query.limit, result.total) };
    });
  },
  kardex(actor: InventoryActor, query: KardexQuery) {
    return read(async (tx) => {
      const access = await loadBranchAccess(tx, actor);
      await validateAuthorizedWarehouse(tx, access, query.almacen_id);
      return getKardexInTransaction(tx, actor.empresaId, query);
    });
  },
};
