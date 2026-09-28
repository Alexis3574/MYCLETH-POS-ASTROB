import { Router } from "express";
import { saleController } from "./sale.controller.js";

export const saleRouter = Router();

saleRouter.post(
  "/",
  saleController.create,
);