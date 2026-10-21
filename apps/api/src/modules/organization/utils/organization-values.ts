import { Prisma } from "../../../generated/prisma/client.js";
export function serializeOrganization(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, current: unknown) => {
    if (typeof current === "bigint") return current.toString();
    if (current instanceof Prisma.Decimal) return current.toFixed();
    return current;
  }));
}
