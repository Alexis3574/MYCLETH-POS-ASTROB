import { z } from "zod";

const idSchema = z.coerce
  .string()
  .regex(/^\d+$/, "El ID debe ser válido");

const decimalSchema = z.union([
  z.number(),
  z
    .string()
    .trim()
    .regex(
      /^\d+(\.\d+)?$/,
      "El valor debe ser numérico",
    ),
]);

const saleDetailSchema = z.object({
  producto_id: idSchema,

  descripcion: z
    .string()
    .trim()
    .max(250)
    .nullable()
    .optional(),

  cantidad: decimalSchema,

  precio_unitario: decimalSchema,

  costo_unitario: decimalSchema
    .nullable()
    .optional(),

  descuento_porcentaje:
    decimalSchema.default(0),

  tasa_impuesto:
    decimalSchema.default(0),

  subtotal_linea: decimalSchema,

  descuento_importe:
    decimalSchema.default(0),

  impuesto_importe:
    decimalSchema.default(0),

  total_linea: decimalSchema,
});

export const createSaleSchema = z.object({
  empresa_id: idSchema,
  sucursal_id: idSchema,
  almacen_id: idSchema,

  cliente_id: idSchema
    .nullable()
    .optional(),

  usuario_id: idSchema,

  sesion_caja_id: idSchema
    .nullable()
    .optional(),

  folio: z
    .string()
    .trim()
    .min(1, "El folio es obligatorio")
    .max(50),

  subtotal: decimalSchema,

  descuento:
    decimalSchema.default(0),

  impuesto:
    decimalSchema.default(0),

  total: decimalSchema,

  observaciones: z
    .string()
    .trim()
    .nullable()
    .optional(),

  detalles: z
    .array(saleDetailSchema)
    .min(
      1,
      "La venta debe contener al menos un producto",
    ),
});

export type CreateSaleInput =
  z.infer<typeof createSaleSchema>;