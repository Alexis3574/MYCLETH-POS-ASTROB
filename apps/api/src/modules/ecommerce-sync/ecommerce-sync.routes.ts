import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/permission.middleware.js";
import { ecommerceSyncController } from "./controllers/ecommerce-sync.controller.js";

export const ecommerceSyncRouter = Router();

ecommerceSyncRouter.use(requireAuth);

ecommerceSyncRouter.get(
  "/",
  requirePermission("ECOMMERCE_SYNC.VER"),
  ecommerceSyncController.list
);

ecommerceSyncRouter.get(
  "/summary",
  requirePermission("ECOMMERCE_SYNC.VER"),
  ecommerceSyncController.summary
);

ecommerceSyncRouter.get(
  "/diagnostics",
  requirePermission("ECOMMERCE_SYNC.VER"),
  ecommerceSyncController.diagnostics
);

ecommerceSyncRouter.get(
  "/:id",
  requirePermission("ECOMMERCE_SYNC.VER"),
  ecommerceSyncController.get
);

ecommerceSyncRouter.post(
  "/:id/retry",
  requirePermission("ECOMMERCE_SYNC.REINTENTAR"),
  ecommerceSyncController.retry
);
