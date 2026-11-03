import type { Request, RequestHandler } from "express";
import { z } from "zod";

import {
  companySettingsService,
  SettingsError,
  type SettingsActor,
} from "./company-settings.service.js";

import {
  settingKeySchema,
  updateSettingSchema,
} from "./company-settings.schema.js";

function actor(req: Request): SettingsActor {
  if (!req.auth) {
    throw new SettingsError(
      401,
      "SETTINGS_AUTH_REQUIRED",
      "Autenticación requerida.",
    );
  }

  return {
    empresaId: req.auth.empresaId,
    userId: req.auth.userId,
  };
}

function endpoint(
  handler: (req: Request) => Promise<unknown>,
): RequestHandler {
  return async (req, res) => {
    try {
      const data = await handler(req);
      res.status(200).json({ ok: true, data });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          ok: false,
          code: "SETTINGS_VALIDATION",
          message: "Configuración inválida.",
          errors: error.issues.map(issue => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        });
      } else if (error instanceof SettingsError) {
        res.status(error.status).json({
          ok: false,
          code: error.code,
          message: error.message,
        });
      } else {
        console.error("[company-settings]", error);
        res.status(500).json({
          ok: false,
          code: "SETTINGS_INTERNAL",
          message: "Error interno de configuración.",
        });
      }
    }
  };
}

export const companySettingsController = {
  list: endpoint(req =>
    companySettingsService.list(actor(req))
  ),

  get: endpoint(req =>
    companySettingsService.get(
      actor(req),
      settingKeySchema.parse(req.params.clave),
    )
  ),

  update: endpoint(req => {
    const key = settingKeySchema.parse(req.params.clave);
    const body = updateSettingSchema.parse(req.body);

    return companySettingsService.update(
      actor(req),
      key,
      body.valor,
    );
  }),
};
