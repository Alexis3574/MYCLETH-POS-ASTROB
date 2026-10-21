import { z } from 'zod';
import { decimalString } from './utils/quote-values.js';

const LIMIT = 9223372036854775807n;
export const quoteIdSchema = z.string()
  .refine(v => /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= LIMIT, 'ID fuera de rango BIGINT.')
  .transform(BigInt);

const posInt = (max: number, fallback: string) => z.string()
  .regex(/^[1-9]\d{0,6}$/, 'Debe ser un entero positivo.')
  .refine(v => Number(v) <= max, `Límite máximo: ${max}.`)
  .transform(Number).prefault(fallback);

const decimal = (scale: number, positive = false, integerDigits = 14 - scale) =>
  z.union([z.string().max(40), z.number().finite()])
    .refine(v => decimalString(v, scale, positive, integerDigits) !== null, 'Decimal inválido o fuera de precisión.')
    .transform(v => decimalString(v, scale, positive, integerDigits)!);

const percent = decimal(4, false, 3).refine(v => Number(v) <= 100, 'Porcentaje máximo 100.');
const date = z.iso.date().refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00.000Z`)), 'Fecha inválida.');
const optionalNotes = z.string().trim().max(2000).nullable().optional();
const detail = z.strictObject({
  producto_id: quoteIdSchema,
  cantidad: decimal(3, true),
  descuento_porcentaje: percent.default('0.0000'),
  descripcion: z.string().trim().max(250).nullable().optional(),
});
export const quoteDetailsSchema = z.array(detail).min(1).max(100)
  .refine(v => new Set(v.map(item => item.producto_id.toString())).size === v.length,
    'No se permiten productos repetidos.');

export const quoteCreateSchema = z.strictObject({
  sucursal_id: quoteIdSchema,
  cliente_id: quoteIdSchema.nullable().optional(),
  folio: z.string().trim().min(1).max(50).regex(/^[\p{L}\p{N}_./-]+$/u, 'Folio con caracteres inválidos.'),
  valida_hasta: date.nullable().optional(),
  observaciones: optionalNotes,
  detalles: quoteDetailsSchema,
});
export const quoteUpdateSchema = z.strictObject({
  cliente_id: quoteIdSchema.nullable().optional(),
  valida_hasta: date.nullable().optional(),
  observaciones: optionalNotes,
  detalles: quoteDetailsSchema.optional(),
}).refine(v => Object.keys(v).length > 0, 'Indique al menos un campo.');
export const quoteListSchema = z.strictObject({
  sucursal_id: quoteIdSchema.optional(),
  cliente_id: quoteIdSchema.optional(),
  estado: z.enum(['BORRADOR', 'ENVIADA', 'ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CONVERTIDA', 'CANCELADA']).optional(),
  q: z.string().trim().min(1).max(50).optional(),
  page: posInt(1_000_000, '1'),
  pageSize: posInt(100, '20'),
});
export const quoteActionSchema = z.strictObject({});
export type QuoteCreate = z.infer<typeof quoteCreateSchema>;
export type QuoteUpdate = z.infer<typeof quoteUpdateSchema>;
export type QuoteList = z.infer<typeof quoteListSchema>;
export type QuoteDetails = z.infer<typeof quoteDetailsSchema>;
