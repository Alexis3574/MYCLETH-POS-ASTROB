import { Prisma } from "../../generated/prisma/client.js";

export const decimal = (amount: string) => new Prisma.Decimal(amount);


export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  ));
}

export function computeExpected(
  opening: Prisma.Decimal,
  totals: { tipo: string; _sum: { monto: Prisma.Decimal | null } }[],
): Prisma.Decimal {
  return totals.reduce((running, item) => {
    const amount = item._sum.monto ?? new Prisma.Decimal(0);
    return item.tipo === "ENTRADA"
      ? running.plus(amount)
      : item.tipo === "SALIDA"
        ? running.minus(amount)
        : running;
  }, opening);
}
