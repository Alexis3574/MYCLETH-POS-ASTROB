import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { paymentMethodController } from "./controllers/payment-method.controller.js";

export const paymentMethodRouter = Router();

// Catálogo compartido: autenticación obligatoria, exclusivamente GET.
// No se expone POST/PATCH/PUT/DELETE; CONFIGURACION.GESTIONAR es un permiso por empresa.
paymentMethodRouter.use(requireAuth);
paymentMethodRouter.get("/", paymentMethodController.list);
paymentMethodRouter.get("/:id", paymentMethodController.get);
