import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError } from "zod";
import { productService } from "../services/product.service.js";
import { ProductError } from "../errors/product.errors.js";
import { productIdSchema, barcodeSchema, createProductSchema, updateProductSchema, productStatusSchema, productQuerySchema, catalogQuerySchema } from "../product.schema.js";
import type { CatalogKind } from "../types/product.types.js";

type Action = (req: Request, res: Response, empresaId: bigint) => Promise<void>;

function endpoint(action: Action): RequestHandler {
  return async (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ ok: false, code: "AUTH_REQUIRED", message: "Autenticación requerida." });
      return;
    }
    try {
      await action(req, res, req.auth.empresaId);
    } catch (error) {
      handleError(error, res, next);
    }
  };
}

function handleError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof ZodError) {
    res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "Datos inválidos.",
      errors: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) });
    return;
  }
  if (error instanceof ProductError) {
    res.status(error.status).json({ ok: false, code: error.code, message: error.message, field: error.field });
    return;
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "P2002") {
      const meta = "meta" in error ? error.meta : null;
      const target = typeof meta === "object" && meta !== null && "target" in meta ? JSON.stringify(meta.target) : "";
      const field = target?.includes("codigo_barras") ? "codigo_barras" : target?.includes("sku") ? "sku" : undefined;
      res.status(409).json({ ok: false, code: field === "codigo_barras" ? "PRODUCT_BARCODE_ALREADY_EXISTS" : field === "sku" ? "PRODUCT_SKU_ALREADY_EXISTS" : "PRODUCT_ALREADY_EXISTS",
        message: "Ya existe un producto con ese SKU o código de barras en la empresa.", field });
      return;
    }
    if (error.code === "P2003") {
      res.status(409).json({ ok: false, code: "PRODUCT_REFERENCE_CONFLICT", message: "Una referencia cambió; actualice los catálogos y vuelva a intentar." });
      return;
    }
    if (error.code === "P2004") {
      res.status(400).json({ ok: false, code: "PRODUCT_DATABASE_CONSTRAINT", message: "Los datos no cumplen una restricción del producto en la base de datos." });
      return;
    }
  }
  next(error);
}

export const productController = {
  list: endpoint(async (req, res, empresaId) => {
    res.json({ ok: true, ...await productService.list(empresaId, productQuerySchema.parse(req.query)) });
  }),
  get: endpoint(async (req, res, empresaId) => {
    res.json({ ok: true, data: await productService.get(empresaId, productIdSchema.parse(req.params.id)) });
  }),
  barcode: endpoint(async (req, res, empresaId) => {
    res.json({ ok: true, data: await productService.barcode(empresaId, barcodeSchema.parse(req.params.barcode)) });
  }),
  create: endpoint(async (req, res, empresaId) => {
    res.status(201).json({ ok: true, data: await productService.create(empresaId, createProductSchema.parse(req.body)) });
  }),
  update: endpoint(async (req, res, empresaId) => {
    res.json({ ok: true, data: await productService.update(empresaId, productIdSchema.parse(req.params.id), updateProductSchema.parse(req.body)) });
  }),
  status: endpoint(async (req, res, empresaId) => {
    const input = productStatusSchema.parse(req.body);
    res.json({ ok: true, data: await productService.status(empresaId, productIdSchema.parse(req.params.id), input.activo) });
  }),
};

export function catalogController(kind: CatalogKind): RequestHandler {
  return endpoint(async (req, res, empresaId) => {
    res.json({ ok: true, ...await productService.catalog(empresaId, kind, catalogQuerySchema.parse(req.query)) });
  });
}
