import { z } from 'zod';
import { normalizePositiveDecimal } from './utils/purchase-values.js';

const id = z.string().regex(/^[1-9]\d{0,18}$/).refine((value) => BigInt(value) <= 9223372036854775807n).transform(BigInt);
const txt = (max: number) => z.string().trim().min(1).max(max);
const decimal = (scale: number, positive = false) => z.union([z.string(), z.number().finite()])
  .refine((value) => normalizePositiveDecimal(value, scale, positive) !== null, `Valor inválido, máximo ${scale} decimales.`)
  .transform((value) => normalizePositiveDecimal(value, scale, positive)!);
const percentage = decimal(4).refine((value) => Number(value) <= 100, 'Debe estar entre 0 y 100.');

export const purchaseCreateSchema = z.object({
  sucursal_id: id,
  almacen_id: id,
  proveedor_id: id,
  folio: txt(50),
  factura_proveedor: txt(80).nullable().optional(),
  observaciones: z.string().trim().max(2000).nullable().optional(),
  detalles: z.array(z.object({
    producto_id: id,
    descripcion: z.string().trim().max(250).nullable().optional(),
    cantidad: decimal(3, true),
    precio_unitario: decimal(4),
    descuento_porcentaje: percentage.default('0.0000'),
    tasa_impuesto: percentage.default('0.0000'),
  }).strict()).min(1).max(100),
}).strict();

export const purchasePaymentSchema = z.object({
  metodo_pago_id: id,
  sesion_caja_id: id.nullable().optional(),
  monto: decimal(2, true),
  referencia: z.string().trim().max(150).nullable().optional(),
}).strict();

export const purchaseCancelSchema = z.object({ motivo: txt(250) }).strict();
export const purchaseListSchema = z.object({
  estado: z.enum(['BORRADOR', 'RECIBIDA', 'CANCELADA']).optional(),
  sucursal_id: id.optional(),
  proveedor_id: id.optional(),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const purchaseKeySchema = z.uuid().transform((value) => value.toLowerCase());
