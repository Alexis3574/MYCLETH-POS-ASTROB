import { createHash } from "node:crypto";

export const MAX_STOCK_UNITS = 99999999999999n;
export const movementTypes = ["ENTRADA", "SALIDA", "AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "TRANSFERENCIA_ENTRADA", "TRANSFERENCIA_SALIDA"] as const;
export type MovementType = typeof movementTypes[number];
export type AdjustmentType = "AJUSTE_POSITIVO" | "AJUSTE_NEGATIVO";

export function validId(value: string): boolean {
  return /^\d{1,19}$/.test(value) && BigInt(value) > 0n && BigInt(value) <= 9223372036854775807n;
}

export function normalizeDecimal(value: string | number, scale: number): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!match) return null;
  const integer = match[1]!.replace(/^0+(?=\d)/, "");
  const fraction = match[2] ?? "";
  if (integer.length > 14 - scale || fraction.length > scale) return null;
  return `${integer}.${fraction.padEnd(scale, "0")}`;
}

export function decimalUnits(value: string, scale = 3): bigint {
  const normalized = normalizeDecimal(value, scale);
  if (normalized === null) throw new Error("Decimal inválido.");
  return BigInt(normalized.replace(".", ""));
}

export function wholeQuantity(value: string): boolean {
  return decimalUnits(value) % 1000n === 0n;
}

export function signedMovementUnits(tipo: MovementType, cantidad: string): bigint {
  const units = decimalUnits(cantidad);
  return ["ENTRADA", "AJUSTE_POSITIVO", "TRANSFERENCIA_ENTRADA"].includes(tipo) ? units : -units;
}

export interface HashableAdjustment {
  almacen_id: bigint;
  producto_id: bigint;
  tipo: AdjustmentType;
  cantidad: string;
  costo_unitario: string | null;
  motivo: string;
  sincronizar_ecommerce: boolean;
}

export function adjustmentHash(usuarioId: bigint, input: HashableAdjustment): string {
  // Orden explícito y cantidades normalizadas; 1 y 1.000 representan lo mismo.
  const canonical = JSON.stringify({
    usuario_id: usuarioId.toString(),
    almacen_id: input.almacen_id.toString(), producto_id: input.producto_id.toString(),
    tipo: input.tipo, cantidad: input.cantidad, costo_unitario: input.costo_unitario,
    motivo: input.motivo, sincronizar_ecommerce: input.sincronizar_ecommerce,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function adjustmentOperationId(empresaId: bigint, ajusteId: bigint, tipo: AdjustmentType): string {
  const operation = tipo === "AJUSTE_POSITIVO" ? "stock-in" : "stock-out";
  return `inventory-adjustment:company:${empresaId}:id:${ajusteId}:${operation}`;
}

export function formatSignedDecimal(value: string, scale: number): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[3]?.length ?? 0) > scale) throw new Error("Decimal de PostgreSQL inválido.");
  const integer = match[2]!.replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").padEnd(scale, "0");
  const sign = match[1] === "-" && (BigInt(integer) !== 0n || /[1-9]/.test(fraction)) ? "-" : "";
  return `${sign}${integer}.${fraction}`;
}
