import { z } from "zod";

const MAX_BIGINT = 9223372036854775807n;
const identifier = z.string()
  .refine((value) => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= MAX_BIGINT,
    "Identificador inválido o fuera del rango BIGINT.")
  .transform((value) => BigInt(value));

export const paymentMethodIdSchema = identifier;

// Zod 4: strictObject rechaza empresa_id, campos de actualización y filtros inesperados.
const positivePage = (max: number, fallback: string) => z.string()
  .regex(/^[1-9]\d{0,6}$/, "Debe ser un entero positivo.")
  .refine((value) => Number(value) <= max, `El límite permitido es ${max}.`)
  .transform(Number)
  .prefault(fallback);

export const paymentMethodListSchema = z.strictObject({
  page: positivePage(1_000_000, "1"),
  pageSize: positivePage(100, "25"),
  // Por seguridad operativa, el endpoint principal muestra solo métodos habilitados.
  activo: z.enum(["true", "false", "all"]).default("true"),
  q: z.string().trim().min(1).max(80).optional(),
  codigo: z.string().trim().min(1).max(30)
    .regex(/^[A-Za-z0-9_.-]+$/, "Código inválido.")
    .transform((value) => value.toUpperCase()).optional(),
});

export type PaymentMethodListInput = z.infer<typeof paymentMethodListSchema>;
