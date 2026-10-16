import {
  Router,
} from "express";

import {
  requireAuth,
} from "../../middleware/auth.middleware.js";

import {
  requirePermission,
} from "../../middleware/permission.middleware.js";

import {
  saleController,
} from "./sale.controller.js";

import {
  saleQueryController,
} from "./sale.query.controller.js";

import {
  saleFinancialController,
} from "./financial/sale-financial.controller.js";

import {
  saleReturnRouter,
} from "./returns/sale-return.routes.js";

export const saleRouter =
  Router();

saleRouter.get(
  "/",
  requireAuth,
  requirePermission(
    "VENTAS.VER",
  ),
  saleQueryController.list,
);

saleRouter.get(
  "/:id/financial-summary",
  requireAuth,
  requirePermission(
    "VENTAS.VER",
  ),
  saleFinancialController.getSummary,
);

saleRouter.get(
  "/:id",
  requireAuth,
  requirePermission(
    "VENTAS.VER",
  ),
  saleQueryController.getById,
);

saleRouter.post(
  "/",
  requireAuth,
  requirePermission(
    "VENTAS.CREAR",
  ),
  saleController.create,
);

saleRouter.patch(
  "/:id/cancel",
  requireAuth,
  requirePermission(
    "VENTAS.CANCELAR",
  ),
  saleController.cancel,
);

saleRouter.use(
  "/:id/returns",
  saleReturnRouter,
);
