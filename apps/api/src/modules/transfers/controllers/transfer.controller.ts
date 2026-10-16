import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { TransferError, translateTransferError } from "../errors/transfer.errors.js";
import { cancelTransferSchema, completeTransferSchema, createTransferSchema, transferIdSchema, transferKeySchema, transferQuerySchema } from "../transfer.schema.js";
import { transferQueryService } from "../services/transfer-query.service.js";
import { transferWriteService } from "../services/transfer-write.service.js";
import type { TransferActor } from "../types/transfer.types.js";

type Action = (req: Request, res: Response, actor: TransferActor) => Promise<void>;

function handleError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({ ok: false, code: "VALIDATION_ERROR", message: "Datos inválidos.",
      errors: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) });
    return;
  }
  const translated = translateTransferError(error);
  if (translated instanceof TransferError) {
    res.status(translated.status).json({ ok: false, code: translated.code, message: translated.message, field: translated.field });
    return;
  }
  next(translated);
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

export const transferController = {
  list: endpoint(async (req, res, actor) => {
    res.json({ ok: true, ...await transferQueryService.list(actor.empresaId, transferQuerySchema.parse(req.query)) });
  }),
  detail: endpoint(async (req, res, actor) => {
    res.json({ ok: true, data: await transferQueryService.get(actor.empresaId, transferIdSchema.parse(req.params.id)) });
  }),
  create: endpoint(async (req, res, actor) => {
    const key = transferKeySchema.parse(req.get("Idempotency-Key"));
    const result = await transferWriteService.create(actor, createTransferSchema.parse(req.body), key);
    if (result.replayed) res.set("Idempotent-Replay", "true");
    res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
  }),
  complete: endpoint(async (req, res, actor) => {
    const key = transferKeySchema.parse(req.get("Idempotency-Key"));
    const id = transferIdSchema.parse(req.params.id);
    completeTransferSchema.parse(req.body ?? {});
    const result = await transferWriteService.complete(actor, id, key);
    if (result.replayed) res.set("Idempotent-Replay", "true");
    res.json({ ok: true, ...result });
  }),
  cancel: endpoint(async (req, res, actor) => {
    const key = transferKeySchema.parse(req.get("Idempotency-Key"));
    const id = transferIdSchema.parse(req.params.id);
    const input = cancelTransferSchema.parse(req.body);
    const result = await transferWriteService.cancel(actor, id, key, input.motivo);
    if (result.replayed) res.set("Idempotent-Replay", "true");
    res.json({ ok: true, ...result });
  }),
};
