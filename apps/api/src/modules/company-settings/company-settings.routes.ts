import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/permission.middleware.js";
import { companySettingsController as ctrl } from "./company-settings.controller.js";

export const companySettingsRouter = Router();

companySettingsRouter.use(requireAuth);
companySettingsRouter.use(
  requirePermission("CONFIGURACION.GESTIONAR"),
);

companySettingsRouter.get("/", ctrl.list);
companySettingsRouter.get("/:clave", ctrl.get);
companySettingsRouter.put("/:clave", ctrl.update);
