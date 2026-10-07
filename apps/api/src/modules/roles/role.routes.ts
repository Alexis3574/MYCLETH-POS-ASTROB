import { Router } from "express";

import {
  requireAuth,
} from "../../middleware/auth.middleware.js";

import {
  requirePermission,
} from "../../middleware/permission.middleware.js";

import {
  roleController,
} from "./role.controller.js";

export const roleRouter =
  Router();

roleRouter.get(
  "/",
  requireAuth,
  requirePermission(
    "USUARIOS.VER",
  ),
  roleController.list,
);

roleRouter.get(
  "/:id",
  requireAuth,
  requirePermission(
    "USUARIOS.VER",
  ),
  roleController.getById,
);

roleRouter.post(
  "/",
  requireAuth,
  requirePermission(
    "USUARIOS.GESTIONAR",
  ),
  roleController.create,
);

roleRouter.patch(
  "/:id",
  requireAuth,
  requirePermission(
    "USUARIOS.GESTIONAR",
  ),
  roleController.update,
);

roleRouter.delete(
  "/:id",
  requireAuth,
  requirePermission(
    "USUARIOS.GESTIONAR",
  ),
  roleController.remove,
);