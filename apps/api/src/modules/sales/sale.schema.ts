import { z } from "zod";

const idSchema = z.coerce
  .string()
  .regex(
    /^\d+$/,
    "El ID debe ser válido",
  );

const numericDecimalSchema = z.union([
  z
    .number()
    .finite(),

  z
    .string()
    .trim()
    .regex(
      /^\d+(\.\d+)?$/,
      "El valor debe ser numérico",
    )
    .transform(Number),
]);

const quantitySchema =
  numericDecimalSchema
    .refine(
      (value) =>
        value > 0,
      {
        message:
          "La cantidad debe ser mayor que cero",
      },
    )
    .refine(
      (value) => {
        const scaled =
          value * 1000;

        return (
          Math.abs(
            scaled -
              Math.round(scaled),
          ) < 0.00000001
        );
      },
      {
        message:
          "La cantidad puede tener como máximo 3 decimales",
      },
    );

const percentageSchema =
  numericDecimalSchema
    .refine(
      (value) =>
        value >= 0 &&
        value <= 100,
      {
        message:
          "El porcentaje debe estar entre 0 y 100",
      },
    )
    .refine(
      (value) => {
        const scaled =
          value * 10000;

        return (
          Math.abs(
            scaled -
              Math.round(scaled),
          ) < 0.00000001
        );
      },
      {
        message:
          "El porcentaje puede tener como máximo 4 decimales",
      },
    );

const paymentAmountSchema =
  numericDecimalSchema
    .refine(
      (value) =>
        value > 0,
      {
        message:
          "El monto del pago debe ser mayor que cero",
      },
    )
    .refine(
      (value) => {
        const cents =
          value * 100;

        return (
          Math.abs(
            cents -
              Math.round(cents),
          ) <
          0.00000001
        );
      },
      {
        message:
          "El monto del pago puede tener como máximo 2 decimales",
      },
    )
    .refine(
      (value) =>
        value <=
        999999999999.99,
      {
        message:
          "El monto del pago es demasiado grande",
      },
    );

const saleDetailSchema =
  z.object({
    producto_id:
      idSchema,

    descripcion: z
      .string()
      .trim()
      .max(250)
      .nullable()
      .optional(),

    cantidad:
      quantitySchema,

    descuento_porcentaje:
      percentageSchema
        .default(0),
  });

const salePaymentSchema =
  z.object({
    metodo_pago_id:
      idSchema,

    monto:
      paymentAmountSchema,

    referencia: z
      .string()
      .trim()
      .max(
        150,
        "La referencia no puede superar los 150 caracteres",
      )
      .nullable()
      .optional(),
  });

export const createSaleSchema =
  z.object({
    empresa_id:
      idSchema,

    sucursal_id:
      idSchema,

    almacen_id:
      idSchema,

    cliente_id:
      idSchema
        .nullable()
        .optional(),

    sesion_caja_id:
      idSchema
        .nullable()
        .optional(),

    folio: z
      .string()
      .trim()
      .min(
        1,
        "El folio es obligatorio",
      )
      .max(50),

    observaciones: z
      .string()
      .trim()
      .nullable()
      .optional(),

    detalles: z
      .array(
        saleDetailSchema,
      )
      .min(
        1,
        "La venta debe contener al menos un producto",
      ),

    pagos: z
      .array(
        salePaymentSchema,
      )
      .min(
        1,
        "La venta debe contener al menos un pago",
      ),
  });

export type CreateSaleInput =
  z.infer<
    typeof createSaleSchema
  >;
