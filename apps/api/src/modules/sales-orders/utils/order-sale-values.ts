import { Prisma } from '../../../generated/prisma/client.js';
import { lineAmounts } from './order-values.js';

const D = Prisma.Decimal;

export interface OrderValueRow {
  cantidad: Prisma.Decimal;
  precio_unitario: Prisma.Decimal;
  descuento_porcentaje: Prisma.Decimal;
  tasa_impuesto: Prisma.Decimal;
  subtotal_linea: Prisma.Decimal;
  descuento_importe: Prisma.Decimal;
  impuesto_importe: Prisma.Decimal;
  total_linea: Prisma.Decimal;
}

/** Rejects drift between source rows and PostgreSQL-calculated historical amounts. */
export function checkOrderLineIntegrity(row: OrderValueRow): boolean {
  const amounts = lineAmounts(
    row.cantidad.toFixed(3), row.precio_unitario.toFixed(4),
    row.descuento_porcentaje.toFixed(4), row.tasa_impuesto.toFixed(4),
  );
  return amounts.subtotal.eq(row.subtotal_linea)
    && amounts.descuento.eq(row.descuento_importe)
    && amounts.impuesto.eq(row.impuesto_importe)
    && amounts.total.eq(row.total_linea);
}

export function sumMoney(rows: OrderValueRow[]): {
  subtotal: Prisma.Decimal; descuento: Prisma.Decimal;
  impuesto: Prisma.Decimal; total: Prisma.Decimal;
} {
  return rows.reduce((totals, line) => ({
    subtotal: totals.subtotal.plus(line.subtotal_linea),
    descuento: totals.descuento.plus(line.descuento_importe),
    impuesto: totals.impuesto.plus(line.impuesto_importe),
    total: totals.total.plus(line.total_linea),
  }), { subtotal: new D(0), descuento: new D(0), impuesto: new D(0), total: new D(0) });
}

export function centsEqual(value: string | number, amount: Prisma.Decimal): boolean {
  return new D(value).eq(amount);
}
