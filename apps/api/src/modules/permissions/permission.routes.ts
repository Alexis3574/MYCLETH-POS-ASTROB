import { Router } from "express";

import {
  requireAuth,
} from "../../middleware/auth.middleware.js";

import {
  requirePermission,
} from "../../middleware/permission.middleware.js";

import {
  permissionController,
} from "./permission.controller.js";

export const permissionRouter =
  Router();

permissionRouter.get(
  "/",
  requireAuth,
  requirePermission(
    "USUARIOS.VER",
  ),
  permissionController.list,
);