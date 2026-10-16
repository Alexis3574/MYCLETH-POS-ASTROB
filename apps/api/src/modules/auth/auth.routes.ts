import {
  Router,
} from "express";

import {
  requireAuth,
} from "../../middleware/auth.middleware.js";

import {
  authController,
} from "./auth.controller.js";

export const authRouter =
  Router();

authRouter.post(
  "/login",
  authController.login,
);

authRouter.get(
  "/me",
  requireAuth,
  authController.me,
);