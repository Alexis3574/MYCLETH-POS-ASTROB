import { z } from "zod";

const MAX_ID = 9223372036854775807n;

export const auditIdSchema = z.string()
  .trim()
  .regex(/^[1-9]\d*$/, "ID invalido.")
  .refine(value => !/^[1-9][0-9]*$/.test(value) || (value.length <= 19 && BigInt(value) <= MAX_ID), "ID fuera de rango.")
  .transform(value => BigInt(value));

const positiveNumber = z.string()
  .regex(/^[1-9]\d*$/, "Debe ser un entero positivo.")
  .transform(Number)
  .pipe(z.number().int().positive().safe());

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

const isoDateTime =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i;

function parseDate(value: string, endOfDay: boolean): Date | null {
  if (dateOnly.test(value)) {
    const start = new Date(`${value}T00:00:00.000Z`);

    if (
      Number.isNaN(start.getTime()) ||
      start.toISOString().slice(0, 10) !== value
    ) {
      return null;
    }

    return endOfDay
      ? new Date(start.getTime() + 86400000 - 1)
      : start;
  }

  if (!isoDateTime.test(value)) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateSchema(endOfDay: boolean) {
  return z.string()
    .trim()
    .refine(
      value => parseDate(value, endOfDay) !== null,
      "Fecha invalida. Utilice YYYY-MM-DD o ISO 8601 con zona horaria."
    )
    .transform(value => parseDate(value, endOfDay) as Date);
}

export const auditListSchema = z.object({
  page: positiveNumber.pipe(z.number().max(10000))
    .optional().default(1),

  limit: positiveNumber.pipe(z.number().max(100))
    .optional().default(20),

  usuario_id: auditIdSchema.optional(),

  usuario: z.string().trim().min(1).max(80).optional(),

  tabla: z.string().trim()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(100).optional(),

  registro_id: auditIdSchema.optional(),

  accion: z.enum([
    "INSERT", "UPDATE", "DELETE",
    "LOGIN", "LOGOUT", "OTRA"
  ]).optional(),

  fecha_desde: dateSchema(false).optional(),
  fecha_hasta: dateSchema(true).optional(),

  q: z.string().trim().min(1).max(80).optional()
}).strict().superRefine((value, ctx) => {
  if (
    value.fecha_desde &&
    value.fecha_hasta &&
    value.fecha_desde > value.fecha_hasta
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["fecha_hasta"],
      message: "La fecha final no puede ser anterior a la inicial."
    });
  }
});

export type AuditListQuery = z.infer<typeof auditListSchema>;
