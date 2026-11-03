import type {
  NextFunction,
  Request,
  RequestHandler,
  Response
} from "express";

import { ZodError } from "zod";

import {
  auditIdSchema,
  auditListSchema
} from "../validators/audit.schema.js";

import {
  auditService
} from "../services/audit.service.js";

import {
  AuditNotFoundError
} from "../errors/audit.errors.js";

import type {
  AuditActor
} from "../types/audit.types.js";

type Action = (
  req: Request,
  res: Response,
  actor: AuditActor
) => Promise<void>;

function endpoint(action: Action): RequestHandler {
  return async (
    req: Request,
    res: Response,
    _next: NextFunction
  ) => {
    if (!req.auth) {
      res.status(401).json({
        ok: false,
        code: "AUTH_REQUIRED",
        message: "Autenticacion requerida."
      });
      return;
    }

    try {
      await action(req, res, {
        empresaId: req.auth.empresaId,
        userId: req.auth.userId
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          ok: false,
          code: "VALIDATION_ERROR",
          message: "Parametros de auditoria invalidos.",
          errors: error.issues.map(issue => ({
            field: issue.path.join("."),
            message: issue.message
          }))
        });
        return;
      }

      if (error instanceof AuditNotFoundError) {
        res.status(404).json({
          ok: false,
          code: error.code,
          message: error.message
        });
        return;
      }

      console.error("[audit-logs] Error interno:", error);
      res.status(500).json({
        ok: false,
        code: "AUDIT_INTERNAL_ERROR",
        message: "Error interno consultando auditoria."
      });
    }
  };
}

export const auditController = {
  list: endpoint(async (req, res, actor) => {
    const query = auditListSchema.parse(req.query);
    const result = await auditService.list(actor, query);

    res.status(200).json({
      ok: true,
      ...result
    });
  }),

  getById: endpoint(async (req, res, actor) => {
    const id = auditIdSchema.parse(
      String(req.params.id)
    );

    const result = await auditService.getById(
      actor,
      id
    );

    res.status(200).json({
      ok: true,
      data: result
    });
  })
};
