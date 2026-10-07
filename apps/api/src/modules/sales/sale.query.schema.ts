import { z } from "zod";

const MAX_BIGINT_ID =
  9223372036854775807n;

const dateOnlyRegex =
  /^\d{4}-\d{2}-\d{2}$/;

function parseDateInput(
  value: string,
  endOfDay: boolean,
): Date | null {
  const normalizedValue =
    dateOnlyRegex.test(value)
      ? `${value}T${
          endOfDay
            ? "23:59:59.999"
            : "00:00:00.000"
        }Z`
      : value;

  const date =
    new Date(
      normalizedValue,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return null;
  }

  return date;
}

const queryIdSchema =
  z
    .string()
    .trim()
    .superRefine(
      (
        value,
        ctx,
      ) => {
        if (
          !/^\d+$/.test(
            value,
          )
        ) {
          ctx.addIssue({
            code:
              z.ZodIssueCode
                .custom,

            message:
              "El ID debe ser válido.",
          });

          return;
        }

        const id =
          BigInt(value);

        if (
          id <= 0n ||
          id >
            MAX_BIGINT_ID
        ) {
          ctx.addIssue({
            code:
              z.ZodIssueCode
                .custom,

            message:
              "El ID debe estar dentro del rango válido.",
          });
        }
      },
    )
    .transform(
      (value) =>
        BigInt(value),
    );

const fechaDesdeSchema =
  z
    .string()
    .trim()
    .min(
      1,
      "fecha_desde no puede estar vacía.",
    )
    .refine(
      (value) =>
        parseDateInput(
          value,
          false,
        ) !== null,
      {
        message:
          "fecha_desde debe ser una fecha válida.",
      },
    )
    .transform(
      (value) =>
        parseDateInput(
          value,
          false,
        ) as Date,
    );

const fechaHastaSchema =
  z
    .string()
    .trim()
    .min(
      1,
      "fecha_hasta no puede estar vacía.",
    )
    .refine(
      (value) =>
        parseDateInput(
          value,
          true,
        ) !== null,
      {
        message:
          "fecha_hasta debe ser una fecha válida.",
      },
    )
    .transform(
      (value) =>
        parseDateInput(
          value,
          true,
        ) as Date,
    );

export const listSalesQuerySchema =
  z
    .object({
      page: z.coerce
        .number()
        .int(
          "page debe ser un número entero.",
        )
        .min(
          1,
          "page debe ser mayor o igual a 1.",
        )
        .default(1),

      limit: z.coerce
        .number()
        .int(
          "limit debe ser un número entero.",
        )
        .min(
          1,
          "limit debe ser mayor o igual a 1.",
        )
        .max(
          100,
          "limit no puede superar 100.",
        )
        .default(20),

      folio: z
        .string()
        .trim()
        .min(
          1,
          "folio no puede estar vacío.",
        )
        .max(
          50,
          "folio no puede superar 50 caracteres.",
        )
        .optional(),

      estado: z
        .string()
        .trim()
        .min(
          1,
          "estado no puede estar vacío.",
        )
        .max(
          20,
          "estado no puede superar 20 caracteres.",
        )
        .transform(
          (value) =>
            value.toUpperCase(),
        )
        .optional(),

      condicion_pago: z
        .string()
        .trim()
        .min(
          1,
          "condicion_pago no puede estar vacía.",
        )
        .max(
          20,
          "condicion_pago no puede superar 20 caracteres.",
        )
        .transform(
          (value) =>
            value.toUpperCase(),
        )
        .optional(),

      fecha_desde:
        fechaDesdeSchema
          .optional(),

      fecha_hasta:
        fechaHastaSchema
          .optional(),

      sucursal_id:
        queryIdSchema
          .optional(),

      almacen_id:
        queryIdSchema
          .optional(),

      cliente_id:
        queryIdSchema
          .optional(),

      usuario_id:
        queryIdSchema
          .optional(),
    })
    .superRefine(
      (
        data,
        ctx,
      ) => {
        if (
          data.fecha_desde &&
          data.fecha_hasta &&
          data.fecha_desde >
            data.fecha_hasta
        ) {
          ctx.addIssue({
            code:
              z.ZodIssueCode
                .custom,

            path: [
              "fecha_hasta",
            ],

            message:
              "fecha_hasta no puede ser anterior a fecha_desde.",
          });
        }
      },
    );

export type ListSalesQueryInput =
  z.infer<
    typeof listSalesQuerySchema
  >;