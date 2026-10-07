export class InventoryError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly field?: string) {
    super(message);
    this.name = "InventoryError";
  }
}

export const warehouseNotFound = () => new InventoryError(404, "INVENTORY_WAREHOUSE_NOT_FOUND", "Almacén no encontrado en la empresa.", "almacen_id");
export const inventoryProductNotFound = () => new InventoryError(404, "INVENTORY_PRODUCT_NOT_FOUND", "Producto no encontrado en la empresa.", "producto_id");

export function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}
