import { Router } from "express";

import {
  requireAuth,
} from "../../middleware/auth.middleware.js";

import {
  requirePermission,
} from "../../middleware/permission.middleware.js";

import {
  reportHandler,
} from "./reports.controller.js";

import type {
  ReportKind,
} from "./reports.schema.js";

export const reportsRouter = Router();

reportsRouter.use(requireAuth);
reportsRouter.use(
  requirePermission("REPORTES.VER")
);

const definitions: ReadonlyArray<{
  kind: ReportKind;
  permission: string;
}> = [
  { kind: "ventas", permission: "VENTAS.VER" },
  { kind: "devoluciones", permission: "VENTAS.VER" },
  { kind: "compras", permission: "COMPRAS.VER" },
  { kind: "inventario", permission: "INVENTARIO.VER" },
  { kind: "existencias", permission: "INVENTARIO.VER" },
  { kind: "caja", permission: "CAJAS.VER" },
];

for (const { kind, permission } of definitions) {
  reportsRouter.get(
    `/${kind}`,
    requirePermission(permission),
    reportHandler(kind, false),
  );

  reportsRouter.get(
    `/${kind}/export.csv`,
    requirePermission(permission),
    reportHandler(kind, true),
  );
}
