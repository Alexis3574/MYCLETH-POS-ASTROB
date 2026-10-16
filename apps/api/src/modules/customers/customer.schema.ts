import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).nullable().optional();
const email = z.email().max(180).transform((v) => v.toLowerCase()).nullable().optional();
const taxId = z.string().trim().toUpperCase()
  // RFC mexicano genérico y personas físicas/morales. El RFC es opcional.
  .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, "RFC no válido: deben ser 12 o 13 caracteres.")
  .nullable().optional();
const money = z.union([z.string(), z.number().finite()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, "Importe DECIMAL(14,2) inválido."));

const credit = z.strictObject({
  limite_credito: money.optional(),
  dias_credito: z.number().int().min(0).max(3650).optional(),
});

export const createCustomerSchema = z.strictObject({
  codigo: text(40),
  nombre: text(180),
  rfc: taxId,
  email,
  telefono: optionalText(30),
  limite_credito: money.optional(),
  dias_credito: z.number().int().min(0).max(3650).optional(),
  activo: z.boolean().optional(),
});

export const updateCustomerSchema = z.strictObject({
  codigo: text(40).optional(),
  nombre: text(180).optional(),
  rfc: taxId,
  email,
  telefono: optionalText(30),
  limite_credito: credit.shape.limite_credito,
  dias_credito: credit.shape.dias_credito,
  activo: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, "Debe indicar al menos un campo.");

export const customerListSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(180).optional(),
  activo: z.enum(["true", "false"]).optional(),
});

const addressFields = {
  // El listado exacto de tipos permitidos por los CHECK físicos se confirmará en la fase de validación.
  tipo: text(20).optional(),
  calle: optionalText(180),
  numero_exterior: optionalText(30),
  numero_interior: optionalText(30),
  colonia: optionalText(120),
  municipio: optionalText(120),
  estado: optionalText(120),
  codigo_postal: optionalText(15),
  pais: text(80).optional(),
  es_principal: z.boolean().optional(),
};

export const createCustomerAddressSchema = z.strictObject(addressFields);
export const updateCustomerAddressSchema = z.strictObject(addressFields)
  .refine((v) => Object.keys(v).length > 0, "Debe indicar al menos un campo.");
