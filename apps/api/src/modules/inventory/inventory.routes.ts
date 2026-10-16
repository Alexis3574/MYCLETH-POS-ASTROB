import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/permission.middleware.js";
import { inventoryController } from "./controllers/inventory.controller.js";

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);
inventoryRouter.get("/warehouses", requirePermission("INVENTARIO.VER"), inventoryController.warehouses);
inventoryRouter.get("/stock", requirePermission("INVENTARIO.VER"), inventoryController.stock);
inventoryRouter.get("/movements", requirePermission("INVENTARIO.VER"), inventoryController.movements);
inventoryRouter.get("/kardex", requirePermission("INVENTARIO.VER"), inventoryController.kardex);
inventoryRouter.post("/adjustments", requirePermission("INVENTARIO.AJUSTAR"), inventoryController.adjust);
