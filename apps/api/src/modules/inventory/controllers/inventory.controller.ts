import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { InventoryError, errorCode } from "../errors/inventory.errors.js";
import { createAdjustmentSchema, idempotencyKeySchema, kardexQuerySchema, movementsQuerySchema, stockQuerySchema, warehousesQuerySchema } from "../inventory.schema.js";
import { inventoryQueryService } from "../services/inventory-query.service.js";
import { inventoryAdjustmentService } from "../services/inventory-adjustment.service.js";
import type { InventoryActor } from "../types/inventory.types.js";

type Action = (req: Request, res: Response, actor: InventoryActor) => Promise<void>;

function handleError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof ZodError) {
    res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "Datos inválidos.",
      errors: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) });
    return;
  }
  if (error instanceof InventoryError) {
    res.status(error.status).json({ ok: false, code: error.code, message: error.message, field: error.field });
    return;
  }
  const code = errorCode(error);
  if (code === "P2002" || code === "P2003" || code === "P2034" || code === "P2028") {
    res.status(409).json({ ok: false, code: "INVENTORY_TRANSACTION_CONFLICT", message: "Conflicto de transacción; reintente con la misma clave de idempotencia." });
    return;
  }
  next(error);
}

function endpoint(action: Action): RequestHandler {
  return async (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ ok: false, code: "AUTH_REQUIRED", message: "Autenticación requerida." });
      return;
    }
    try { await action(req, res, { empresaId: req.auth.empresaId, userId: req.auth.userId }); }
    catch (error) { handleError(error, res, next); }
  };
}

export const inventoryController = {
  warehouses: endpoint(async (req, res, actor) => {
    res.json({ ok: true, ...await inventoryQueryService.warehouses(actor.empresaId, warehousesQuerySchema.parse(req.query)) });
  }),
  stock: endpoint(async (req, res, actor) => {
    res.json({ ok: true, ...await inventoryQueryService.stock(actor.empresaId, stockQuerySchema.parse(req.query)) });
  }),
  movements: endpoint(async (req, res, actor) => {
    res.json({ ok: true, ...await inventoryQueryService.movements(actor.empresaId, movementsQuerySchema.parse(req.query)) });
  }),
  kardex: endpoint(async (req, res, actor) => {
    res.json({ ok: true, ...await inventoryQueryService.kardex(actor.empresaId, kardexQuerySchema.parse(req.query)) });
  }),
  adjust: endpoint(async (req, res, actor) => {
    const key = idempotencyKeySchema.parse(req.get("Idempotency-Key"));
    const input = createAdjustmentSchema.parse(req.body);
    const result = await inventoryAdjustmentService.create(actor, input, key);
    res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
  }),
};
