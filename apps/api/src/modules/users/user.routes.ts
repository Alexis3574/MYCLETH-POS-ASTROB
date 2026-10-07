import { Router } from "express";

import {
  requireAuth,
} from "../../middleware/auth.middleware.js";

import {
  requirePermission,
} from "../../middleware/permission.middleware.js";

import {
  userController,
} from "./user.controller.js";

export const userRouter = Router();

userRouter.get(
  "/count",
  requireAuth,
  requirePermission("USUARIOS.VER"),
  userController.count,
);

userRouter.get(
  "/",
  requireAuth,
  requirePermission("USUARIOS.VER"),
  userController.list,
);

userRouter.get(
  "/:id",
  requireAuth,
  requirePermission("USUARIOS.VER"),
  userController.getById,
);

userRouter.post(
  "/",
  requireAuth,
  requirePermission("USUARIOS.GESTIONAR"),
  userController.create,
);

userRouter.patch(
  "/:id/password",
  requireAuth,
  requirePermission("USUARIOS.GESTIONAR"),
  userController.changePassword,
);

userRouter.patch(
  "/:id",
  requireAuth,
  requirePermission("USUARIOS.GESTIONAR"),
  userController.update,
);