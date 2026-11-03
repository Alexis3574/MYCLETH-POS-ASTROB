import { z } from 'zod';
import { decimalText, ORDER_STATES } from './utils/order-values.js';

const BIGINT_LIMIT = 9223372036854775807n;
export const orderIdSchema = z.string()
  .refine(v => /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= BIGINT_LIMIT, 'ID BIGINT inválido.')
  .transform(BigInt);

const decimal = (scale: number, positive = false, digits = 14 - scale) =>
  z.union([z.string().max(40), z.number().finite()])
    .refine(v => decimalText(v, scale, positive, digits) !== null, 'Decimal fuera de rango o precisión.')
    .transform(v => decimalText(v, scale, positive, digits)!);
const percent = decimal(4, false, 3).refine(v => Number(v) <= 100, 'Máximo 100%.');
const calendarDate = z.iso.date();
const notes = z.string().trim().max(2000).nullable().optional();
const folio = z.string().trim().min(1).max(50).regex(/^[\p{L}\p{N}_.\/-]+$/u);

export const orderDetailSchema = z.strictObject({
  producto_id: orderIdSchema,
  cantidad: decimal(3, true),
  descuento_porcentaje: percent.default('0.0000'),
  descripcion: z.string().trim().max(250).nullable().optional(),
});
export const orderDetailsSchema = z.array(orderDetailSchema).min(1).max(100)
  .refine(rows => new Set(rows.map(r => r.producto_id.toString())).size === rows.length,
    'No se permiten productos duplicados.');

export const orderCreateSchema = z.strictObject({
  sucursal_id: orderIdSchema,
  cliente_id: orderIdSchema.nullable().optional(),
  folio,
  fecha_compromiso: calendarDate.nullable().optional(),
  observaciones: notes,
  detalles: orderDetailsSchema,
});
export const orderUpdateSchema = z.strictObject({
  cliente_id: orderIdSchema.nullable().optional(),
  fecha_compromiso: calendarDate.nullable().optional(),
  observaciones: notes,
  detalles: orderDetailsSchema.optional(),
}).refine(v => Object.keys(v).length > 0, 'Indique al menos un campo.');
const page = (max: number, fallback: string) => z.string().regex(/^[1-9]\d{0,6}$/).refine(v => Number(v) <= max).transform(Number).prefault(fallback);
export const orderListSchema = z.strictObject({
  sucursal_id: orderIdSchema.optional(),
  cliente_id: orderIdSchema.optional(),
  estado: z.enum(ORDER_STATES).optional(),
  q: z.string().trim().min(1).max(50).optional(),
  page: page(1_000_000, '1'),
  pageSize: page(100, '20'),
});
export const orderFromQuoteSchema = z.strictObject({
  folio,
  fecha_compromiso: calendarDate.nullable().optional(),
  observaciones: notes,
});
export const orderActionSchema = z.strictObject({});

export type OrderCreate = z.infer<typeof orderCreateSchema>;
export type OrderUpdate = z.infer<typeof orderUpdateSchema>;
export type OrderList = z.infer<typeof orderListSchema>;
export type OrderDetails = z.infer<typeof orderDetailsSchema>;
export type OrderFromQuote = z.infer<typeof orderFromQuoteSchema>;
