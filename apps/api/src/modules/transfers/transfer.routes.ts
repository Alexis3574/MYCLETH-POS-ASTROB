import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/permission.middleware.js";
import { transferController } from "./controllers/transfer.controller.js";

export const transferRouter = Router();
transferRouter.use(requireAuth);
transferRouter.get("/", requirePermission("INVENTARIO.VER"), transferController.list);
transferRouter.get("/:id", requirePermission("INVENTARIO.VER"), transferController.detail);
transferRouter.post("/", requirePermission("INVENTARIO.TRANSFERIR"), transferController.create);
transferRouter.post("/:id/complete", requirePermission("INVENTARIO.TRANSFERIR"), transferController.complete);
transferRouter.post("/:id/cancel", requirePermission("INVENTARIO.TRANSFERIR"), transferController.cancel);
