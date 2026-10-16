import { z } from "zod";

const moneyString = z.union([z.string(), z.number().finite()])
  .transform((value) => String(value).trim())
  .pipe(z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, "Monto inválido: máximo 12 enteros y dos decimales."));

export const nonNegativeMoney = moneyString;
export const positiveMoney = moneyString.refine((value) => !/^0(?:\.0{1,2})?$/.test(value), "El monto debe ser mayor a cero.");

const code = z.string().trim().min(1).max(30);
const name = z.string().trim().min(1).max(100);

export const createCashSchema = z.strictObject({
  sucursal_id: z.string().regex(/^[1-9]\d{0,18}$/),
  codigo: code,
  nombre: name,
});

export const updateCashSchema = z.strictObject({
  nombre: name.optional(),
  codigo: code.optional(),
  activo: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "Debe indicar al menos un cambio.");

export const openCashSchema = z.strictObject({
  monto_apertura: nonNegativeMoney,
  notas: z.string().trim().max(1500).nullable().optional(),
});

export const movementSchema = z.strictObject({
  tipo: z.enum(["ENTRADA", "SALIDA"]),
  concepto: z.string().trim().min(3).max(180),
  monto: positiveMoney,
  // Obligatoria como clave de idempotencia para operaciones manuales.
  referencia: z.string().trim().min(3).max(105),
});

export const closeCashSchema = z.strictObject({
  monto_cierre: nonNegativeMoney,
  notas: z.string().trim().max(1500).nullable().optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const idFromRoute = (value: unknown): bigint => {
  const text = String(value);
  if (!/^[1-9]\d{0,18}$/.test(text) || BigInt(text) > 9223372036854775807n) {
    throw new Error("INVALID_ID");
  }
  return BigInt(text);
};
