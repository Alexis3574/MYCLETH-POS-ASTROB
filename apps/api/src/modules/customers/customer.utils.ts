import { Prisma } from "../../generated/prisma/client.js";

export function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Prisma.Decimal) return v.toFixed();
    return v;
  }));
}

export function idFromRoute(value: unknown): bigint {
  const input = String(value);
  if (!/^[1-9]\d{0,18}$/.test(input)) throw new Error("INVALID_ID");
  const id = BigInt(input);
  if (id > 9223372036854775807n) throw new Error("INVALID_ID");
  return id;
}

export function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "P2002";
}
