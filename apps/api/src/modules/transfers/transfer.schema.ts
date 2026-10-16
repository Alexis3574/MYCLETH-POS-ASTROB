import { z } from "zod";
import { decimalUnits, normalizeDecimal, transferStates, validId } from "./utils/transfer-values.js";

export const transferIdSchema = z.string().trim().refine(validId, "ID fuera del rango válido.").transform(BigInt);
export const transferKeySchema = z.uuid().transform((value) => value.toLowerCase());
const text = (max: number) => z.string().trim().min(1).max(max);
const pageValue = z.string().regex(/^[1-9]\d*$/).max(7).transform(Number).refine(Number.isSafeInteger);
const page = pageValue.refine((value) => value <= 1000000).default(1);
const limit = pageValue.refine((value) => value <= 100).default(20);
const dateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const transferQuantitySchema = z.string().trim().max(100)
  .refine((value) => normalizeDecimal(value, 3) !== null, "Cantidad con hasta 11 enteros y 3 decimales, sin redondeo.")
  .transform((value) => normalizeDecimal(value, 3)!)
  .refine((value) => decimalUnits(value) > 0n, "La cantidad debe ser positiva.");

export const createTransferSchema = z.object({
  almacen_origen_id: transferIdSchema,
  almacen_destino_id: transferIdSchema,
  folio: text(50).optional(),
  observaciones: text(1000).nullable().default(null),
  detalles: z.array(z.object({ producto_id: transferIdSchema, cantidad: transferQuantitySchema }).strict()).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (value.almacen_origen_id === value.almacen_destino_id) {
    context.addIssue({ code: "custom", path: ["almacen_destino_id"], message: "El destino debe ser distinto del origen." });
  }
  const ids = new Set<string>();
  value.detalles.forEach((item, index) => {
    const id = item.producto_id.toString();
    if (ids.has(id)) context.addIssue({ code: "custom", path: ["detalles", index, "producto_id"], message: "Producto repetido." });
    ids.add(id);
  });
});

export const completeTransferSchema = z.object({}).strict();
export const cancelTransferSchema = z.object({ motivo: text(1000) }).strict();
export const transferQuerySchema = z.object({
  estado: z.enum(transferStates).optional(),
  almacen_id: transferIdSchema.optional(),
  almacen_origen_id: transferIdSchema.optional(),
  almacen_destino_id: transferIdSchema.optional(),
  producto_id: transferIdSchema.optional(),
  search: text(180).optional(),
  fecha_desde: dateTime.optional(), fecha_hasta: dateTime.optional(), page, limit,
}).strict().refine((value) => !value.fecha_desde || !value.fecha_hasta || value.fecha_desde <= value.fecha_hasta,
  { path: ["fecha_hasta"], message: "fecha_hasta debe ser igual o posterior a fecha_desde." });
