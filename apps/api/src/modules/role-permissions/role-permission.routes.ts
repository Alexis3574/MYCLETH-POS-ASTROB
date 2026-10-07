import { Router } from "express";

import {
  requireAuth,
} from "../../middleware/auth.middleware.js";

import {
  requirePermission,
} from "../../middleware/permission.middleware.js";

import {
  rolePermissionController,
} from "./role-permission.controller.js";

export const rolePermissionRouter =
  Router();

rolePermissionRouter.get(
  "/:roleId/permissions",
  requireAuth,
  requirePermission(
    "USUARIOS.VER",
  ),
  rolePermissionController.list,
);

rolePermissionRouter.post(
  "/:roleId/permissions/:permissionId",
  requireAuth,
  requirePermission(
    "USUARIOS.GESTIONAR",
  ),
  rolePermissionController.assign,
);

rolePermissionRouter.delete(
  "/:roleId/permissions/:permissionId",
  requireAuth,
  requirePermission(
    "USUARIOS.GESTIONAR",
  ),
  rolePermissionController.remove,
);