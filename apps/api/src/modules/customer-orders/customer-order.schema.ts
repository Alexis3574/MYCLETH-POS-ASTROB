import { z } from 'zod';
import { CUSTOMER_ORDER_STATES, decimalText } from './utils/customer-order-values.js';

const BIGINT_LIMIT = 9223372036854775807n;
export const customerOrderIdSchema = z.string()
  .refine(v => /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= BIGINT_LIMIT, 'ID BIGINT inválido.')
  .transform(BigInt);

const decimal = (scale: number, positive = false, digits = 14 - scale) =>
  z.union([z.string().max(40), z.number().finite()])
    .refine(v => decimalText(v, scale, positive, digits) !== null, 'Decimal fuera de rango o precisión.')
    .transform(v => decimalText(v, scale, positive, digits)!);
const percentage = decimal(4, false, 3).refine(v => Number(v) <= 100, 'Máximo 100%.');
const folio = z.string().trim().min(1).max(50).regex(/^[\p{L}\p{N}_.\/-]+$/u);
const notes = z.string().trim().max(2000).nullable().optional();

export const customerOrderDetailSchema = z.strictObject({
  producto_id: customerOrderIdSchema,
  cantidad: decimal(3, true),
  descuento_porcentaje: percentage.default('0.0000'),
  descripcion: z.string().trim().max(250).nullable().optional(),
});
export const customerOrderDetailsSchema = z.array(customerOrderDetailSchema).min(1).max(100)
  .refine(rows => new Set(rows.map(r => r.producto_id.toString())).size === rows.length,
    'No se permiten productos duplicados.');

export const customerOrderCreateSchema = z.strictObject({
  sucursal_id: customerOrderIdSchema,
  cliente_id: customerOrderIdSchema,
  folio,
  referencia_cliente: z.string().trim().max(100).nullable().optional(),
  fecha_entrega: z.iso.date().nullable().optional(),
  observaciones: notes,
  detalles: customerOrderDetailsSchema,
});

export const customerOrderUpdateSchema = z.strictObject({
  cliente_id: customerOrderIdSchema.optional(),
  referencia_cliente: z.string().trim().max(100).nullable().optional(),
  fecha_entrega: z.iso.date().nullable().optional(),
  observaciones: notes,
  detalles: customerOrderDetailsSchema.optional(),
}).refine(v => Object.keys(v).length > 0, 'Indique al menos un campo.');

const page = (max: number, fallback: string) =>
  z.string().regex(/^[1-9]\d{0,6}$/).refine(v => Number(v) <= max)
    .transform(Number).prefault(fallback);
export const customerOrderListSchema = z.strictObject({
  sucursal_id: customerOrderIdSchema.optional(),
  cliente_id: customerOrderIdSchema.optional(),
  estado: z.enum(CUSTOMER_ORDER_STATES).optional(),
  q: z.string().trim().min(1).max(50).optional(),
  page: page(1_000_000, '1'),
  pageSize: page(100, '20'),
});
export const customerOrderActionSchema = z.strictObject({});

export type CustomerOrderCreate = z.infer<typeof customerOrderCreateSchema>;
export type CustomerOrderUpdate = z.infer<typeof customerOrderUpdateSchema>;
export type CustomerOrderList = z.infer<typeof customerOrderListSchema>;
export type CustomerOrderDetails = z.infer<typeof customerOrderDetailsSchema>;
