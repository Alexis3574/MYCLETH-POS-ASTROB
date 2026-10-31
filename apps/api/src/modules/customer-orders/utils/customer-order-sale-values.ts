import { Prisma } from '../../../generated/prisma/client.js';
import { checkOrderLineIntegrity, sumMoney, type OrderValueRow } from '../../sales-orders/utils/order-sale-values.js';

/** Integridad histórica antes de producir stock, caja u outbox. */
export function verifyCustomerOrderMoney(
  lines: OrderValueRow[],
  header: { subtotal: Prisma.Decimal; descuento: Prisma.Decimal; impuesto: Prisma.Decimal; total: Prisma.Decimal },
): boolean {
  if (lines.length === 0 || lines.some(line => !checkOrderLineIntegrity(line))) return false;
  const totals = sumMoney(lines);
  return totals.subtotal.eq(header.subtotal) && totals.descuento.eq(header.descuento)
    && totals.impuesto.eq(header.impuesto) && totals.total.eq(header.total);
}

/** Política provisional: una sola venta completa por pedido, incluso si la anterior fue cancelada. */
export function customerOrderIsConvertible(state: string, linkedSales: number): boolean {
  return state === 'LISTO' && linkedSales === 0;
}
