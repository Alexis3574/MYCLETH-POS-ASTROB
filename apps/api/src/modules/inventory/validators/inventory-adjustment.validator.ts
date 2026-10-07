import { InventoryError } from "../errors/inventory.errors.js";
import type { AdjustmentInput } from "../types/inventory.types.js";
import { decimalUnits, MAX_STOCK_UNITS, wholeQuantity } from "../utils/inventory-values.js";

export function validateAdjustmentQuantity(
  input: AdjustmentInput,
  product: { codigo_barras: string | null; unidad_medida: { permite_decimales: boolean } },
  stock: { cantidad: string; disponible: string },
) {
  if (!product.unidad_medida.permite_decimales && !wholeQuantity(input.cantidad)) {
    throw new InventoryError(400, "INVENTORY_UNIT_REQUIRES_INTEGER", "La unidad del producto requiere cantidades enteras.", "cantidad");
  }
  if (input.sincronizar_ecommerce && !product.codigo_barras?.trim()) {
    throw new InventoryError(400, "INVENTORY_BARCODE_REQUIRED", "La sincronización requiere un código de barras registrado.", "sincronizar_ecommerce");
  }
  const requested = decimalUnits(input.cantidad);
  if (input.tipo === "AJUSTE_NEGATIVO" && requested > decimalUnits(stock.disponible)) {
    throw new InventoryError(409, "INVENTORY_INSUFFICIENT_AVAILABLE", `Cantidad solicitada: ${input.cantidad}. Disponible: ${stock.disponible}.`, "cantidad");
  }
  if (input.tipo === "AJUSTE_POSITIVO" && decimalUnits(stock.cantidad) + requested > MAX_STOCK_UNITS) {
    throw new InventoryError(400, "INVENTORY_STOCK_LIMIT", "El ajuste supera el rango NUMERIC(14,3) de la existencia.", "cantidad");
  }
}
