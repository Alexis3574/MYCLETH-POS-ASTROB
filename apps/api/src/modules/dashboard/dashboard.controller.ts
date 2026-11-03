import type { Request, RequestHandler } from "express";
import { z } from "zod";

import {
  dashboardService,
  DashboardError,
} from "./dashboard.service.js";

import {
  dashboardQuerySchema,
} from "./dashboard.schema.js";

export const dashboardSummary: RequestHandler =
  async (req: Request, res) => {
    try {
      if (!req.auth) {
        res.status(401).json({
          ok: false,
          code: "DASHBOARD_AUTH",
          message: "Autenticación requerida.",
        });
        return;
      }

      const query = dashboardQuerySchema.parse(req.query);

      const data = await dashboardService.summary({
        empresaId: req.auth.empresaId,
        userId: req.auth.userId,
      }, query);

      res.json({ ok: true, data });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          ok: false,
          code: "DASHBOARD_VALIDATION",
          message: "Parámetros inválidos.",
        });
      } else if (error instanceof DashboardError) {
        res.status(error.status).json({
          ok: false,
          code: error.code,
          message: error.message,
        });
      } else {
        console.error("[dashboard]", error);
        res.status(500).json({
          ok: false,
          code: "DASHBOARD_INTERNAL",
          message: "Error interno.",
        });
      }
    }
  };
