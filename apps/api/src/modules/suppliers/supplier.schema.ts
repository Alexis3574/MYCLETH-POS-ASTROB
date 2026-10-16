import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).nullable().optional();
const email = z.email().max(180).transform((value) => value.toLowerCase()).nullable().optional();
const rfc = z.string().trim().toUpperCase()
  .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, "El RFC debe tener 12 o 13 caracteres y formato válido.")
  .nullable().optional();

export const createSupplierSchema = z.strictObject({
  codigo: text(40),
  razon_social: text(180),
  nombre_comercial: optionalText(180),
  rfc,
  email,
  telefono: optionalText(30),
  contacto: optionalText(180),
  dias_credito: z.number().int().min(0).max(3650).optional(),
  activo: z.boolean().optional(),
});

export const updateSupplierSchema = z.strictObject({
  codigo: text(40).optional(),
  razon_social: text(180).optional(),
  nombre_comercial: optionalText(180),
  rfc,
  email,
  telefono: optionalText(30),
  contacto: optionalText(180),
  dias_credito: z.number().int().min(0).max(3650).optional(),
  activo: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "Debe indicar al menos un campo.");

export const supplierListSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(180).optional(),
  activo: z.enum(["true", "false"]).optional(),
});

const addressFields = {
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

export const createSupplierAddressSchema = z.strictObject(addressFields);
export const updateSupplierAddressSchema = z.strictObject(addressFields)
  .refine((value) => Object.keys(value).length > 0, "Debe indicar al menos un campo.");
