import { TransferError } from "../errors/transfer.errors.js";
import { transferContextRepository as context } from "../repositories/transfer-context.repository.js";
import type { StockState, TransferActor, TransferTransaction } from "../types/transfer.types.js";
import { compareIds, decimalUnits, MAX_STOCK_UNITS, orderedDetails, wholeQuantity } from "../utils/transfer-values.js";

export function requireDraft(state: string): void {
  if (state !== "BORRADOR") throw new TransferError(409, "TRANSFER_INVALID_STATE", "La operación requiere una transferencia en BORRADOR.", "estado");
}

export function validateTransferQuantity(quantity: string, allowsDecimals: boolean, origin?: StockState, destination?: StockState): void {
  if (!allowsDecimals && !wholeQuantity(quantity)) {
    throw new TransferError(400, "TRANSFER_UNIT_REQUIRES_INTEGER", "La unidad del producto requiere cantidades enteras.", "cantidad");
  }
  if (origin && decimalUnits(quantity) > decimalUnits(origin.disponible)) {
    throw new TransferError(409, "TRANSFER_INSUFFICIENT_AVAILABLE", `Cantidad solicitada: ${quantity}. Disponible: ${origin.disponible}.`, "cantidad");
  }
  if (destination && decimalUnits(destination.cantidad) + decimalUnits(quantity) > MAX_STOCK_UNITS) {
    throw new TransferError(400, "TRANSFER_STOCK_LIMIT", "La entrada supera el rango NUMERIC(14,3) del destino.", "cantidad");
  }
}

export async function validateTransferActor(tx: TransferTransaction, actor: TransferActor): Promise<void> {
  if (!await context.lockActor(tx, actor)) throw new TransferError(403, "TRANSFER_ACTOR_INACTIVE", "La cuenta o empresa dejó de estar disponible.");
  if (!await context.canTransfer(tx, actor.userId)) throw new TransferError(403, "TRANSFER_PERMISSION_REQUIRED", "Se requiere el permiso INVENTARIO.TRANSFERIR.");
}

export async function validateTransferContext(tx: TransferTransaction, actor: TransferActor, originId: bigint, destinationId: bigint,
  details: Array<{ producto_id: bigint; cantidad: string }>) {
  if (originId === destinationId) throw new TransferError(400, "TRANSFER_WAREHOUSE_INVALID", "Los almacenes deben ser distintos.", "almacen_destino_id");
  for (const warehouseId of [originId, destinationId].sort(compareIds)) {
    if (!await context.lockWarehouse(tx, actor.empresaId, warehouseId)) {
      throw new TransferError(404, "TRANSFER_WAREHOUSE_NOT_FOUND", "Almacén no encontrado en la empresa.", "almacen_id");
    }
    const warehouse = await context.findWarehouse(tx, actor.empresaId, warehouseId);
    if (!warehouse?.activo || !warehouse.sucursal.activo) {
      throw new TransferError(400, "TRANSFER_WAREHOUSE_INVALID", "El almacén y su sucursal deben estar activos.", "almacen_id");
    }
  }
  if (details.length === 0) throw new TransferError(400, "TRANSFER_EMPTY", "La transferencia requiere al menos un producto.", "detalles");
  const products = new Map<bigint, NonNullable<Awaited<ReturnType<typeof context.findProduct>>>>();
  for (const item of orderedDetails(details)) {
    if (!await context.lockProduct(tx, actor.empresaId, item.producto_id)) {
      throw new TransferError(404, "TRANSFER_PRODUCT_NOT_FOUND", "Producto no encontrado en la empresa.", "producto_id");
    }
    const product = await context.findProduct(tx, actor.empresaId, item.producto_id);
    if (!product?.activo || !product.controla_inventario || product.tipo !== "PRODUCTO" || !product.unidad_medida.activo) {
      throw new TransferError(400, "TRANSFER_PRODUCT_INVALID", "El producto debe estar activo, controlar inventario y tener una unidad activa.", "producto_id");
    }
    validateTransferQuantity(item.cantidad, product.unidad_medida.permite_decimales);
    products.set(item.producto_id, product);
  }
  return products;
}
