import { Router } from "express";

import {
  requireAuth,
} from "../../middleware/auth.middleware.js";

import {
  requirePermission,
} from "../../middleware/permission.middleware.js";

import {
  userRoleController,
} from "./user-role.controller.js";

export const userRoleRouter =
  Router();

userRoleRouter.get(
  "/:userId/roles",
  requireAuth,
  requirePermission(
    "USUARIOS.VER",
  ),
  userRoleController.list,
);

userRoleRouter.post(
  "/:userId/roles/:roleId",
  requireAuth,
  requirePermission(
    "USUARIOS.GESTIONAR",
  ),
  userRoleController.assign,
);

userRoleRouter.delete(
  "/:userId/roles/:roleId",
  requireAuth,
  requirePermission(
    "USUARIOS.GESTIONAR",
  ),
  userRoleController.remove,
);