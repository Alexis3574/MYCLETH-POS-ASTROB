import { z } from 'zod';
import { orderIdSchema } from './order.schema.js';
import { decimalText } from './utils/order-values.js';

const folio = z.string().trim().min(1).max(50).regex(/^[\p{L}\p{N}_.\/-]+$/u);
const money = z.union([z.string().max(40), z.number().finite()])
  .refine(value => decimalText(value, 2, true, 12) !== null, 'Monto de pago inválido.')
  .transform(value => decimalText(value, 2, true, 12)!);

export const orderConvertToSaleSchema = z.strictObject({
  folio,
  almacen_id: orderIdSchema,
  sesion_caja_id: orderIdSchema.nullable().optional(),
  observaciones: z.string().trim().max(2000).nullable().optional(),
  pagos: z.array(z.strictObject({
    metodo_pago_id: orderIdSchema,
    monto: money,
    referencia: z.string().trim().max(150).nullable().optional(),
  })).min(1).max(20),
});

export type OrderConvertToSale = z.infer<typeof orderConvertToSaleSchema>;
