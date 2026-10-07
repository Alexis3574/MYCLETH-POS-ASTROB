import { z } from "zod";
import { normalizeDecimal, validId } from "./utils/product-values.js";

export const productIdSchema = z.string().trim().refine(validId, "ID fuera del rango válido.")
  .transform((value) => BigInt(value));

function decimalSchema(scale: number) {
  return z.union([z.string().max(100), z.number().finite()])
    .refine((value) => normalizeDecimal(value, scale) !== null,
      `Número no negativo, con hasta ${14 - scale} enteros y ${scale} decimales.`)
    .transform((value) => normalizeDecimal(value, scale)!);
}

const text = (length: number) => z.string().trim().min(1).max(length);
export const barcodeSchema = text(80);
const nullableText = (length: number) => z.string().trim().max(length)
  .transform((value) => value || null).nullable();

const editableFields = {
  sku: text(80),
  codigo_barras: nullableText(80),
  nombre: text(180),
  descripcion: nullableText(10000),
  categoria_id: productIdSchema.nullable(),
  costo_referencia: decimalSchema(4),
  precio_venta: decimalSchema(2),
  stock_minimo: decimalSchema(3),
  stock_maximo: decimalSchema(3).nullable(),
  impuesto_ids: z.array(productIdSchema).max(50)
    .refine((ids) => new Set(ids).size === ids.length, "Hay impuestos duplicados."),
};

export const createProductSchema = z.object({
  ...editableFields,
  codigo_barras: editableFields.codigo_barras.default(null),
  descripcion: editableFields.descripcion.default(null),
  categoria_id: editableFields.categoria_id.default(null),
  costo_referencia: editableFields.costo_referencia.default("0.0000"),
  precio_venta: editableFields.precio_venta.default("0.00"),
  stock_minimo: editableFields.stock_minimo.default("0.000"),
  stock_maximo: editableFields.stock_maximo.default(null),
  impuesto_ids: editableFields.impuesto_ids.default([]),
  unidad_medida_id: productIdSchema,
  tipo: z.enum(["PRODUCTO", "SERVICIO"]).default("PRODUCTO"),
  controla_inventario: z.boolean().optional(),
}).strict();


export const updateProductSchema = z.object(editableFields).omit({ sku: true, codigo_barras: true }).partial().strict()
  .refine((value) => Object.keys(value).length > 0, "Indique al menos un campo para editar.");

export const productStatusSchema = z.object({ activo: z.boolean() }).strict();
const queryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");
const positivePage = z.string().regex(/^[1-9]\d*$/).max(10)
  .transform(Number).refine(Number.isSafeInteger);
const page = positivePage.refine((value) => value <= 1000000).default(1);
const limit = positivePage.refine((value) => value <= 100).default(20);

export const productQuerySchema = z.object({
  search: text(180).optional(),
  sku: text(80).optional(),
  barcode: barcodeSchema.optional(),
  categoria_id: productIdSchema.optional(),
  activo: queryBoolean.optional(),
  tipo: z.enum(["PRODUCTO", "SERVICIO"]).optional(),
  page,
  limit,
}).strict();

export const catalogQuerySchema = z.object({
  search: text(180).optional(),
  activo: queryBoolean.optional(),
  page,
  limit,
}).strict();
