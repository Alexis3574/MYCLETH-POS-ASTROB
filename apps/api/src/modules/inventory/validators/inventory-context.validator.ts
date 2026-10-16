import { inventoryContextRepository as context } from "../repositories/inventory-context.repository.js";
import { InventoryError, inventoryProductNotFound, warehouseNotFound } from "../errors/inventory.errors.js";
import type { InventoryActor, InventoryTransaction } from "../types/inventory.types.js";

export async function validateReadWarehouse(tx: InventoryTransaction, empresaId: bigint, id: bigint) {
  const warehouse = await context.findWarehouse(tx, empresaId, id);
  if (!warehouse) throw warehouseNotFound();
  return warehouse;
}

export async function validateReadProduct(tx: InventoryTransaction, empresaId: bigint, id: bigint, requireInventory = false) {
  const product = await context.findProduct(tx, empresaId, id);
  if (!product) throw inventoryProductNotFound();
  if (requireInventory && !product.controla_inventario) {
    throw new InventoryError(400, "PRODUCT_DOES_NOT_CONTROL_INVENTORY", "El producto no controla inventario.", "producto_id");
  }
  return product;
}

export async function validateActor(tx: InventoryTransaction, actor: InventoryActor) {
  if (!await context.findActor(tx, actor.empresaId, actor.userId)) {
    throw new InventoryError(403, "INVENTORY_ACTOR_INACTIVE", "La cuenta o empresa dejó de estar disponible.");
  }
}

export async function validateAdjustmentContext(tx: InventoryTransaction, actor: InventoryActor, almacenId: bigint, productoId: bigint) {
  if (!await context.lockWarehouse(tx, actor.empresaId, almacenId)) throw warehouseNotFound();
  const warehouse = await validateReadWarehouse(tx, actor.empresaId, almacenId);
  if (!warehouse.activo || !warehouse.sucursal.activo) {
    throw new InventoryError(400, "INVENTORY_WAREHOUSE_INACTIVE", "El almacén o su sucursal está inactivo.", "almacen_id");
  }
  if (!await context.lockProduct(tx, actor.empresaId, productoId)) throw inventoryProductNotFound();
  const product = await validateReadProduct(tx, actor.empresaId, productoId, true);
  if (!product.activo || !product.unidad_medida.activo || product.tipo !== "PRODUCTO") {
    throw new InventoryError(400, "INVENTORY_PRODUCT_INACTIVE", "El producto debe estar activo, ser de tipo PRODUCTO y tener una unidad activa.", "producto_id");
  }
  return { warehouse, product };
}
