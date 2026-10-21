import { Prisma } from '../../../generated/prisma/client.js';

/** Preserva la precisión de Decimal(14,s), sin exponentes ni redondeos implícitos. */
export function decimalString(value: string | number, scale: number, positive = false, integerDigits = 14 - scale): string | null {
  const raw = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;
  const integer = match[1]!.replace(/^0+(?=\d)/, '');
  const fraction = match[2] ?? '';
  if (integer.length > integerDigits || fraction.length > scale) return null;
  const normalized = `${integer}.${fraction.padEnd(scale, '0')}`;
  if (positive && new Prisma.Decimal(normalized).lte(0)) return null;
  return normalized;
}

export function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, part: unknown) =>
    typeof part === 'bigint' ? part.toString() : part));
}

export function todayInZone(zone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(v => v.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function quoteTransitionAllowed(from: string, action: 'send' | 'accept' | 'reject' | 'cancel' | 'expire'): boolean {
  const map: Record<typeof action, string[]> = {
    send: ['BORRADOR'],
    accept: ['ENVIADA'],
    reject: ['ENVIADA'],
    cancel: ['BORRADOR', 'ENVIADA'],
    expire: ['ENVIADA'],
  };
  return map[action].includes(from);
}

export function ensureLineFits(quantity: string, price: string, discount: string, tax: string): void {
  // Refleja el orden de ROUND de los triggers PostgreSQL.
  const Decimal = Prisma.Decimal;
  const subtotal = new Decimal(quantity).mul(price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const discountAmount = subtotal.mul(discount).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const taxAmount = subtotal.minus(discountAmount).mul(tax).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const total = subtotal.minus(discountAmount).plus(taxAmount);
  if ([subtotal, discountAmount, taxAmount, total].some(x => x.lt(0) || x.gt('999999999999.99'))) {
    throw new Error('QUOTE_LINE_OVERFLOW');
  }
}
