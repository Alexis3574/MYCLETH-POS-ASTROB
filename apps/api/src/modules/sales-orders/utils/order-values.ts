import { Prisma } from '../../../generated/prisma/client.js';

const D = Prisma.Decimal;
export const MAX_MONEY = new D('999999999999.99');
export const ORDER_STATES = ['PENDIENTE', 'EN_PROCESO', 'LISTA', 'FACTURADA', 'CANCELADA'] as const;

/** No binary floating point in persistence or money calculations. */
export function decimalText(value: string | number, scale: number, positive: boolean, integerDigits: number): string | null {
  const text = typeof value === 'string' ? value.trim() : String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return null;
  const [integer, fraction = ''] = text.split('.');
  if (integer.length > integerDigits || fraction.length > scale) return null;
  const decimal = new D(text);
  if (!decimal.isFinite() || (positive ? !decimal.gt(0) : decimal.lt(0))) return null;
  return decimal.toFixed(scale);
}

export function lineAmounts(quantity: string, price: string, discountPct: string, taxPct: string) {
  const sub = new D(quantity).mul(price).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const discount = sub.mul(discountPct).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const tax = sub.minus(discount).mul(taxPct).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const total = sub.minus(discount).plus(tax);
  if ([sub, discount, tax, total].some(v => v.gt(MAX_MONEY) || v.lt(0))) {
    throw new RangeError('Importe fuera del rango NUMERIC(14,2).');
  }
  return { subtotal: sub, descuento: discount, impuesto: tax, total };
}

export function allowedTransition(state: string, action: 'start' | 'ready' | 'cancel') {
  return (action === 'start' && state === 'PENDIENTE') ||
    (action === 'ready' && state === 'EN_PROCESO') ||
    (action === 'cancel' && ['PENDIENTE', 'EN_PROCESO', 'LISTA'].includes(state));
}

export const destinationState = { start: 'EN_PROCESO', ready: 'LISTA', cancel: 'CANCELADA' } as const;

export function encodeResponse<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return item.toString();
    if (item instanceof D) return item.toFixed();
    return item;
  })) as unknown;
}
