
export function normalizeDecimal(value: string | number, scale: number): string | null {
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const integer = match[1]!.replace(/^0+(?=\d)/, "");
  const fraction = match[2] ?? "";
  if (integer.length > 14 - scale || fraction.length > scale) return null;
  return `${integer}.${fraction.padEnd(scale, "0")}`;
}

export function decimalUnits(value: string, scale: number): bigint {
  const normalized = normalizeDecimal(value, scale);
  if (normalized === null) throw new Error("Decimal inválido.");
  return BigInt(normalized.replace(".", ""));
}

export function stockBoundsValid(minimum: string, maximum: string | null): boolean {
  return maximum === null || decimalUnits(maximum, 3) >= decimalUnits(minimum, 3);
}

export function validId(value: string): boolean {
  return /^\d{1,19}$/.test(value) && BigInt(value) > 0n && BigInt(value) <= 9223372036854775807n;
}
