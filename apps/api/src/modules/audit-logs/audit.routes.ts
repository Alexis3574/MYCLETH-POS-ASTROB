import { Router } from "express";

import {
  requireAuth
} from "../../middleware/auth.middleware.js";

import {
  requirePermission
} from "../../middleware/permission.middleware.js";

import {
  auditController
} from "./controllers/audit.controller.js";

export const auditRouter = Router();

auditRouter.use(requireAuth);

auditRouter.use(
  requirePermission("AUDITORIA.VER")
);

auditRouter.get("/", auditController.list);
auditRouter.get("/:id", auditController.getById);
