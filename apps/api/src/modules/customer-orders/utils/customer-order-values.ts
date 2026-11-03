import { Prisma } from '../../../generated/prisma/client.js';

const D = Prisma.Decimal;
export const MAX_MONEY = new D('999999999999.99');
export const CUSTOMER_ORDER_STATES = [
  'PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'LISTO', 'ENTREGADO', 'FACTURADO', 'CANCELADO',
] as const;

export const destinationState = {
  confirm: 'CONFIRMADO', prepare: 'EN_PREPARACION', ready: 'LISTO',
  deliver: 'ENTREGADO', cancel: 'CANCELADO',
} as const;
export type CustomerOrderAction = keyof typeof destinationState;

export function allowedTransition(state: string, action: CustomerOrderAction): boolean {
  return (action === 'confirm' && state === 'PENDIENTE') ||
    (action === 'prepare' && state === 'CONFIRMADO') ||
    (action === 'ready' && state === 'EN_PREPARACION') ||
    (action === 'deliver' && state === 'LISTO') ||
    (action === 'cancel' && ['PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'LISTO'].includes(state));
}

export function decimalText(value: string | number, scale: number, positive: boolean, integerDigits: number): string | null {
  const text = typeof value === 'string' ? value.trim() : String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return null;
  const [integer, fraction = ''] = text.split('.');
  if (integer!.length > integerDigits || fraction.length > scale) return null;
  const result = new D(text);
  if (!result.isFinite() || (positive ? !result.gt(0) : result.lt(0))) return null;
  return result.toFixed(scale);
}

/** SQL fn_calcular_importes_detalle: ROUND half away from zero for nonnegative amounts. */
export function lineAmounts(quantity: string, price: string, discountPct: string, taxPct: string) {
  const subtotal = new D(quantity).mul(price).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const descuento = subtotal.mul(discountPct).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const impuesto = subtotal.minus(descuento).mul(taxPct).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const total = subtotal.minus(descuento).plus(impuesto);
  if ([subtotal, descuento, impuesto, total].some(v => v.gt(MAX_MONEY) || v.lt(0))) {
    throw new RangeError('Importe fuera del rango NUMERIC(14,2).');
  }
  return { subtotal, descuento, impuesto, total };
}

export function encodeResponse<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return item.toString();
    if (item instanceof D) return item.toFixed();
    return item;
  })) as unknown;
}
