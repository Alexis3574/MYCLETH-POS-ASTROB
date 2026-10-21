import { z } from "zod";

export const POS_BIGINT_MAX = 9223372036854775807n;
export const organizationIdSchema = z.string().regex(/^[1-9]\d{0,18}$/, "ID positivo inválido.")
  .refine((value) => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= POS_BIGINT_MAX, "ID fuera del rango BIGINT.")
  .transform((value) => BigInt(value));
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).nullable().optional();
const code = (max: number) => text(max).transform((value) => value.toUpperCase());
const email = z.email().max(180).transform((value) => value.toLowerCase()).nullable().optional();

export const companyUpdateSchema = z.strictObject({
  razon_social: text(180).optional(),
  nombre_comercial: text(180).optional(),
  rfc: text(20).nullable().optional(),
  telefono: optionalText(30),
  email,
  direccion: z.string().trim().max(2000).nullable().optional(),
  moneda: z.string().regex(/^[A-Z]{3}$/).optional(),
  zona_horaria: text(80).optional(),
}).refine((input) => Object.keys(input).length !== 0, "Indique un campo.");

export const branchCreateSchema = z.strictObject({
  codigo: code(30), nombre: text(120), telefono: optionalText(30), email,
  direccion: z.string().trim().max(2000).nullable().optional(),
});
export const branchUpdateSchema = branchCreateSchema.partial().extend({ activo: z.boolean().optional() })
  .refine((input) => Object.keys(input).length !== 0, "Indique un campo.");
export const warehouseCreateSchema = z.strictObject({
  sucursal_id: organizationIdSchema, codigo: code(30), nombre: text(120),
  descripcion: z.string().trim().max(2000).nullable().optional(),
});
export const warehouseUpdateSchema = z.strictObject({
  codigo: code(30).optional(), nombre: text(120).optional(),
  descripcion: z.string().trim().max(2000).nullable().optional(),
  activo: z.boolean().optional(),
}).refine((input) => Object.keys(input).length !== 0, "Indique un campo.");
const pagination = {
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  activo: z.enum(["true", "false"]).optional(),
  q: z.string().trim().max(120).optional(),
};
export const branchListSchema = z.strictObject(pagination);
export const warehouseListSchema = z.strictObject({
  ...pagination, sucursal_id: organizationIdSchema.optional(),
});
export const assignmentCreateSchema = z.strictObject({
  usuario_id: organizationIdSchema,
  es_predeterminada: z.boolean().optional(),
});
