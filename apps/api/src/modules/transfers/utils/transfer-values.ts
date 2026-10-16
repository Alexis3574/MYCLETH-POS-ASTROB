import { createHash } from "node:crypto";
import { decimalUnits, normalizeDecimal, validId, MAX_STOCK_UNITS, wholeQuantity } from "../../inventory/utils/inventory-values.js";

export { decimalUnits, normalizeDecimal, validId, MAX_STOCK_UNITS, wholeQuantity };
export const transferStates = ["BORRADOR", "COMPLETADA", "CANCELADA"] as const;
export const transferActions = ["CREAR", "COMPLETAR", "CANCELAR"] as const;
export type TransferAction = typeof transferActions[number];

export function compareIds(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function orderedDetails<T extends { producto_id: bigint }>(details: readonly T[]): T[] {
  return [...details].sort((a, b) => compareIds(a.producto_id, b.producto_id));
}

export function transferRequestHash(userId: bigint, action: TransferAction, transferId: bigint | null, content: unknown): string {
  return createHash("sha256").update(JSON.stringify({ usuario_id: userId.toString(), accion: action,
    transferencia_id: transferId?.toString() ?? null, contenido: content })).digest("hex");
}

export function createTransferContent(input: {
  almacen_origen_id: bigint; almacen_destino_id: bigint; folio?: string;
  observaciones: string | null; detalles: Array<{ producto_id: bigint; cantidad: string }>;
}) {
  return { almacen_origen_id: input.almacen_origen_id.toString(), almacen_destino_id: input.almacen_destino_id.toString(),
    folio: input.folio ?? null, observaciones: input.observaciones,
    detalles: orderedDetails(input.detalles).map((item) => ({ producto_id: item.producto_id.toString(), cantidad: item.cantidad })) };
}

export function unitsToDecimal(units: bigint, scale: number): string {
  if (units < 0n) throw new Error("No se permiten unidades negativas.");
  const value = units.toString().padStart(scale + 1, "0");
  return `${value.slice(0, -scale)}.${value.slice(-scale)}`;
}

export function destinationAverage(before: { cantidad: string; costo_promedio: string }, quantity: string, sourceCost: string): string {
  const previous = decimalUnits(before.cantidad);
  const incoming = decimalUnits(quantity);
  const numerator = previous * decimalUnits(before.costo_promedio, 4) + incoming * decimalUnits(sourceCost, 4);
  const denominator = previous + incoming;
  if (denominator <= 0n) throw new Error("La entrada debe producir una cantidad positiva.");
  return unitsToDecimal((2n * numerator + denominator) / (2n * denominator), 4);
}
