import type { MovementRecord } from "../repositories/inventory-movement.repository.js";
import type { StockRecord } from "../repositories/inventory-stock.repository.js";
import type { KardexRow } from "../repositories/inventory-kardex.repository.js";
import type { LockedStock } from "../types/inventory.types.js";
import { InventoryError } from "../errors/inventory.errors.js";
import { decimalUnits, formatSignedDecimal } from "./inventory-values.js";

export function stockState(row: LockedStock | null) {
  if (row && row.disponible === null) {
    throw new InventoryError(500, "INVENTORY_DATABASE_INVARIANT", "La existencia registrada no tiene un disponible válido.");
  }
  return {
    cantidad: formatSignedDecimal(row?.cantidad ?? "0", 3),
    reservado: formatSignedDecimal(row?.reservado ?? "0", 3),
    disponible: formatSignedDecimal(row?.disponible ?? "0", 3),
    costo_promedio: formatSignedDecimal(row?.costo_promedio ?? "0", 4),
  };
}

export function serializeStock(product: StockRecord, almacenId: bigint) {
  const row = product.existencia[0];
  const state = stockState(row ? {
    cantidad: row.cantidad.toFixed(3), reservado: row.reservado.toFixed(3),
    disponible: row.disponible?.toFixed(3) ?? null, costo_promedio: row.costo_promedio.toFixed(4),
  } : null);
  return {
    producto: { id: product.id.toString(), sku: product.sku, codigo_barras: product.codigo_barras, nombre: product.nombre, activo: product.activo },
    almacen_id: almacenId.toString(), ...state, existencia_registrada: Boolean(row),
    stock_minimo: product.stock_minimo.toFixed(3), stock_maximo: product.stock_maximo?.toFixed(3) ?? null,
    bajo_minimo: decimalUnits(state.disponible) < decimalUnits(product.stock_minimo.toFixed(3)),
    unidad: { ...product.unidad_medida, id: product.unidad_medida.id.toString() },
    actualizado_en: row?.actualizado_en.toISOString() ?? null,
  };
}

export function serializeMovement(row: MovementRecord) {
  const sync = row.sincronizacion_ecommerce_inventario;
  return {
    id: row.id.toString(), producto: { ...row.producto, id: row.producto.id.toString() },
    almacen: { ...row.almacen, id: row.almacen.id.toString(), sucursal_id: row.almacen.sucursal_id.toString() },
    usuario_id: row.usuario_id?.toString() ?? null,
    tipo: row.tipo, cantidad: row.cantidad.toFixed(3), costo_unitario: row.costo_unitario?.toFixed(4) ?? null,
    documento_tipo: row.documento_tipo, documento_id: row.documento_id?.toString() ?? null,
    documento_detalle_id: row.documento_detalle_id?.toString() ?? null,
    motivo: row.motivo, fecha: row.fecha.toISOString(), creado_en: row.creado_en.toISOString(),
    sincronizacion: sync ? { ...sync, id: sync.id.toString(), sincronizado_en: sync.sincronizado_en?.toISOString() ?? null } : null,
  };
}

export function serializeKardexRow(row: KardexRow) {
  return {
    id: row.id.toString(), tipo: row.tipo, cantidad: formatSignedDecimal(row.cantidad, 3),
    delta: formatSignedDecimal(row.delta, 3), saldo_antes: formatSignedDecimal(row.saldo_antes, 3),
    saldo_despues: formatSignedDecimal(row.saldo_despues, 3),
    costo_unitario: row.costo_unitario === null ? null : formatSignedDecimal(row.costo_unitario, 4),
    documento_tipo: row.documento_tipo, documento_id: row.documento_id?.toString() ?? null,
    documento_detalle_id: row.documento_detalle_id?.toString() ?? null,
    usuario_id: row.usuario_id?.toString() ?? null, motivo: row.motivo, fecha: row.fecha.toISOString(),
  };
}

export function pagination(page: number, limit: number, total: number) {
  return { page, limit, total, total_pages: Math.ceil(total / limit) };
}

export function countToNumber(value: string) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Conteo fuera del rango de paginación.");
  return count;
}
