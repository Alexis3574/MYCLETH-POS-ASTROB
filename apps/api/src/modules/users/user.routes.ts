import { Router } from "express";
import { userController } from "./user.controller.js";

export const userRouter = Router();

userRouter.get("/count", userController.count);

userRouter.get( "/",userController.list);

userRouter.get("/:id", userController.getById);

userRouter.post("/", userController.create);

userRouter.patch(  "/:id/password",  userController.changePassword);

userRouter.patch("/:id", userController.update);