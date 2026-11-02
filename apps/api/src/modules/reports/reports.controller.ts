import type { RequestHandler } from "express";
import { z } from "zod";

import {
  reportsService,
  ReportError,
} from "./reports.service.js";

import {
  parseReportQuery,
  type ReportKind,
} from "./reports.schema.js";

import {
  buildReportCsv,
} from "./reports.csv.js";

export function reportHandler(
  kind: ReportKind,
  exportMode: boolean,
): RequestHandler {
  return async (req, res) => {
    try {
      if (!req.auth) {
        res.status(401).json({
          ok: false,
          code: "REPORT_AUTH",
          message: "Autenticacion requerida.",
        });
        return;
      }

      const query = parseReportQuery(
        kind,
        req.query,
      );

      const result = await reportsService.list(
        {
          empresaId: req.auth.empresaId,
          userId: req.auth.userId,
        },
        kind,
        query,
        exportMode,
      );

      res.setHeader(
        "Cache-Control",
        "private, no-store",
      );

      if (exportMode) {
        res.setHeader(
          "Content-Type",
          "text/csv; charset=utf-8",
        );

        res.setHeader(
          "Content-Disposition",
          `attachment; filename="reporte-${kind}.csv"`,
        );

        res.status(200).send(
          buildReportCsv(kind, result.data)
        );
        return;
      }

      res.status(200).json({
        ok: true,
        data: result,
      });

    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          ok: false,
          code: "REPORT_VALIDATION",
          message: "Parametros invalidos.",
        });
        return;
      }

      if (error instanceof ReportError) {
        res.status(error.status).json({
          ok: false,
          code: error.code,
          message: error.message,
        });
        return;
      }

      console.error("[reports]", error);

      res.status(500).json({
        ok: false,
        code: "REPORT_INTERNAL",
        message: "Error interno.",
      });
    }
  };
}
