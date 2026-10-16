import { Prisma } from "../../generated/prisma/client.js";


export function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString();
    if (item instanceof Prisma.Decimal) return item.toFixed();
    return item;
  }));
}

export function idFromRoute(value: unknown): bigint {
  const text = String(value);
  if (!/^[1-9]\d{0,18}$/.test(text)) throw new Error("INVALID_ID");
  const result = BigInt(text);
  if (result > 9223372036854775807n) throw new Error("INVALID_ID");
  return result;
}

export function isPrismaErrorCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === code;
}
