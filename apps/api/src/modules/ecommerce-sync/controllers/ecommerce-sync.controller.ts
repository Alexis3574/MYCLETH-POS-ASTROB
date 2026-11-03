import type { Request, RequestHandler } from "express";
import { z } from "zod";
import { ecommerceSyncRetryService } from "../services/ecommerce-sync.retry.service.js";
import {
  syncIdSchema,
  syncListSchema
} from "../ecommerce-sync.schema.js";
import {
  EcommerceSyncError,
  ecommerceSyncService,
  type SyncActor
} from "../services/ecommerce-sync.service.js";

function actor(req: Request): SyncActor {
  if (!req.auth) {
    throw new EcommerceSyncError(
      401,
      "ECOMMERCE_SYNC_AUTH_REQUIRED",
      "Autenticación requerida."
    );
  }

  return {
    empresaId: req.auth.empresaId,
    userId: req.auth.userId
  };
}

function handler(
  operation: (req: Request) => Promise<unknown>
): RequestHandler {
  return async (req, res, next) => {
    try {
      const data = await operation(req);
      res.json({ ok: true, data });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          ok: false,
          code: "ECOMMERCE_SYNC_VALIDATION_ERROR",
          message: "Parámetros inválidos.",
          errors: error.issues.map(issue => ({
            field: issue.path.join("."),
            message: issue.message
          }))
        });
        return;
      }

      if (error instanceof EcommerceSyncError) {
        res.status(error.status).json({
          ok: false,
          code: error.code,
          message: error.message
        });
        return;
      }

      next(error);
    }
  };
}

export const ecommerceSyncController = {
  list: handler(req =>
    ecommerceSyncService.list(
      actor(req),
      syncListSchema.parse(req.query)
    )
  ),

  summary: handler(req =>
    ecommerceSyncService.summary(actor(req))
  ),

  diagnostics: handler(req =>
    ecommerceSyncService.diagnostics(actor(req))
  ),

  get: handler(req =>
    ecommerceSyncService.get(
      actor(req),
      syncIdSchema.parse(req.params.id)
    )
  ),

  retry: handler(req =>
    ecommerceSyncRetryService.authorize(
      actor(req),
      syncIdSchema.parse(req.params.id)
    )
  )
};
