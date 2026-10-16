import {
  Router,
} from "express";

import {
  requireAuth,
} from "../../../middleware/auth.middleware.js";

import {
  requirePermission,
} from "../../../middleware/permission.middleware.js";

import {
  saleReturnController,
} from "./controllers/sale-return.controller.js";

import {
  saleReturnQueryController,
} from "./controllers/sale-return.query.controller.js";

export const saleReturnRouter =
  Router({
    mergeParams: true,
  });

saleReturnRouter.get(
  "/",
  requireAuth,
  requirePermission(
    "VENTAS.VER",
  ),
  saleReturnQueryController.list,
);

saleReturnRouter.get(
  "/:returnId",
  requireAuth,
  requirePermission(
    "VENTAS.VER",
  ),
  saleReturnQueryController.getById,
);

saleReturnRouter.post(
  "/",
  requireAuth,
  requirePermission(
    "VENTAS.DEVOLVER",
  ),
  saleReturnController.create,
);