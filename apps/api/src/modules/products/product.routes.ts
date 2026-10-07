import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/permission.middleware.js";
import { productController, catalogController } from "./controllers/product.controller.js";
import type { CatalogKind } from "./types/product.types.js";

export const productRouter = Router();
productRouter.use(requireAuth);
productRouter.get("/", requirePermission("PRODUCTOS.VER"), productController.list);
// Ruta específica primero para que barcode no se interprete como un ID.
productRouter.get("/barcode/:barcode", requirePermission("PRODUCTOS.VER"), productController.barcode);
productRouter.get("/:id", requirePermission("PRODUCTOS.VER"), productController.get);
productRouter.post("/", requirePermission("PRODUCTOS.CREAR"), productController.create);
productRouter.patch("/:id/status", requirePermission("PRODUCTOS.CAMBIAR_ESTADO"), productController.status);
productRouter.patch("/:id", requirePermission("PRODUCTOS.EDITAR"), productController.update);

function catalogRouter(kind: CatalogKind) {
  const router = Router();
  router.get("/", requireAuth, requirePermission("PRODUCTOS.VER"), catalogController(kind));
  return router;
}

export const categoryRouter = catalogRouter("categories");
export const unitRouter = catalogRouter("units");
export const taxRouter = catalogRouter("taxes");
