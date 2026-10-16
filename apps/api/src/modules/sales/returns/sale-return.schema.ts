import { z } from "zod";

const idSchema = z.coerce
  .string()
  .regex(
    /^\d+$/,
    "Debe ser un ID válido.",
  );

const quantitySchema = z.coerce
  .number()
  .positive(
    "La cantidad debe ser mayor a cero.",
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
    "La cantidad admite máximo 3 decimales.",
  );

const moneySchema = z.coerce
  .number()
  .positive(
    "El monto debe ser mayor a cero.",
  )
  .refine(
    (value) => {
      const scaled =
        value * 100;

      return (
        Math.abs(
          scaled -
            Math.round(scaled),
        ) < 0.00000001
      );
    },
    "El monto admite máximo 2 decimales.",
  );

export const createSaleReturnSchema =
  z.object({
    folio: z
      .string()
      .trim()
      .min(
        1,
        "El folio es obligatorio.",
      )
      .max(
        50,
        "El folio no puede superar 50 caracteres.",
      ),

    motivo: z
      .string()
      .trim()
      .min(
        3,
        "El motivo debe tener al menos 3 caracteres.",
      )
      .max(
        250,
        "El motivo no puede superar 250 caracteres.",
      ),

    sesion_caja_id:
      idSchema
        .nullable()
        .optional(),

    detalles: z
      .array(
        z.object({
          venta_detalle_id:
            idSchema,

          cantidad:
            quantitySchema,
        }),
      )
      .min(
        1,
        "La devolución debe contener al menos un producto.",
      ),

    reembolsos: z
      .array(
        z.object({
          venta_pago_id:
            idSchema,

          monto:
            moneySchema,

          referencia: z
            .string()
            .trim()
            .max(150)
            .nullable()
            .optional(),
        }),
      )
      .min(
        1,
        "La devolución debe contener al menos un reembolso.",
      ),
  });
