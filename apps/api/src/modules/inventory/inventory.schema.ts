import { z } from "zod";
import { decimalUnits, movementTypes, normalizeDecimal, validId } from "./utils/inventory-values.js";

export const inventoryIdSchema = z.string().trim().refine(validId, "ID fuera del rango válido.").transform(BigInt);
export const idempotencyKeySchema = z.uuid().transform((value) => value.toLowerCase());
const text = (length: number) => z.string().trim().min(1).max(length);
const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");
const pageNumber = z.string().regex(/^[1-9]\d*$/).max(7).transform(Number).refine(Number.isSafeInteger);
const page = pageNumber.refine((value) => value <= 1000000).default(1);
const limit = pageNumber.refine((value) => value <= 100).default(20);
const dateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

function decimal(scale: number) {
  return z.union([z.string().max(100), z.number().finite()])
    .refine((value) => normalizeDecimal(value, scale) !== null, `Número no negativo, hasta ${14 - scale} enteros y ${scale} decimales.`)
    .transform((value) => normalizeDecimal(value, scale)!);
}

export const stockQuerySchema = z.object({
  almacen_id: inventoryIdSchema,
  producto_id: inventoryIdSchema.optional(),
  search: text(180).optional(),
  activo: booleanQuery.optional(),
  page, limit,
}).strict();

export const warehousesQuerySchema = z.object({ search: text(180).optional(), activo: booleanQuery.optional(), page, limit }).strict();

const movementFields = {
  almacen_id: inventoryIdSchema.optional(), producto_id: inventoryIdSchema.optional(),
  tipo: z.enum(movementTypes).optional(), documento_tipo: text(50).optional(),
  documento_id: inventoryIdSchema.optional(), fecha_desde: dateTime.optional(), fecha_hasta: dateTime.optional(),
  page, limit,
};

function dateRangeValid(value: { fecha_desde?: Date; fecha_hasta?: Date }): boolean {
  return !value.fecha_desde || !value.fecha_hasta || value.fecha_desde <= value.fecha_hasta;
}

export const movementsQuerySchema = z.object(movementFields).strict()
  .refine(dateRangeValid, { message: "fecha_hasta debe ser igual o posterior a fecha_desde.", path: ["fecha_hasta"] });

export const kardexQuerySchema = z.object({
  almacen_id: inventoryIdSchema, producto_id: inventoryIdSchema,
  fecha_desde: dateTime.optional(), fecha_hasta: dateTime.optional(), page, limit,
}).strict().refine(dateRangeValid, { message: "fecha_hasta debe ser igual o posterior a fecha_desde.", path: ["fecha_hasta"] });

export const createAdjustmentSchema = z.object({
  almacen_id: inventoryIdSchema, producto_id: inventoryIdSchema,
  tipo: z.enum(["AJUSTE_POSITIVO", "AJUSTE_NEGATIVO"]),
  cantidad: decimal(3).refine((value) => decimalUnits(value) > 0n, "La cantidad debe ser mayor que cero."),
  costo_unitario: decimal(4).nullable().default(null),
  motivo: text(1000), sincronizar_ecommerce: z.boolean().default(true),
}).strict().superRefine((value, ctx) => {
  if (value.tipo === "AJUSTE_NEGATIVO" && value.costo_unitario !== null) {
    ctx.addIssue({ code: "custom", path: ["costo_unitario"], message: "Un ajuste negativo no recibe costo_unitario." });
  }
  if (value.sincronizar_ecommerce && (decimalUnits(value.cantidad) % 1000n !== 0n || decimalUnits(value.cantidad) > 2147483647000n)) {
    ctx.addIssue({ code: "custom", path: ["cantidad"], message: "La sincronización requiere una cantidad entera entre 1 y 2147483647." });
  }
});
