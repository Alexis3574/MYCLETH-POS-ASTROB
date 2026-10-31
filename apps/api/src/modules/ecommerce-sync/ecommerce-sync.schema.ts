import { z } from "zod";

const MAX_ID = 9223372036854775807n;

export const syncIdSchema = z.string()
  .refine(
    v => /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= MAX_ID,
    "ID BIGINT inválido."
  )
  .transform(BigInt);

const numberParam = (max: number, fallback: string) =>
  z.string()
    .regex(/^[1-9]\d{0,6}$/)
    .refine(v => Number(v) <= max)
    .default(fallback)
    .transform(Number);

const dateParam = z.iso.datetime({ offset: true })
  .transform(v => new Date(v));

export const syncListSchema = z.strictObject({
  estado: z.enum([
    "PENDIENTE",
    "PROCESANDO",
    "SINCRONIZADO",
    "AGOTADO", "REINTENTO_MANUAL", "PROCESANDO_MANUAL"
  ]).optional(),
  sucursal_id: syncIdSchema.optional(),
  sku: z.string().trim().min(1).max(80).optional(),
  fecha_desde: dateParam.optional(),
  fecha_hasta: dateParam.optional(),
  page: numberParam(1000000, "1"),
  pageSize: numberParam(100, "20")
}).refine(
  v => !v.fecha_desde || !v.fecha_hasta ||
    v.fecha_desde <= v.fecha_hasta,
  {
    path: ["fecha_hasta"],
    message: "Rango de fechas inválido."
  }
);

export type SyncListQuery = z.infer<typeof syncListSchema>;
