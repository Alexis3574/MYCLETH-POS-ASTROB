import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/permission.middleware.js";
import { CustomerError } from "./customer.errors.js";
import { customerService, type CustomerActor } from "./customer.service.js";
import {
  createCustomerAddressSchema, createCustomerSchema, customerListSchema,
  updateCustomerAddressSchema, updateCustomerSchema,
} from "./customer.schema.js";
import { idFromRoute, isUniqueViolation, jsonSafe } from "./customer.utils.js";

export const customerRouter = Router();
customerRouter.use(requireAuth);

function actorOf(req: Request): CustomerActor {
  if (!req.auth) throw new CustomerError(401, "AUTH_REQUIRED", "Autenticación requerida.");
  return { empresaId: req.auth.empresaId, userId: req.auth.userId };
}

function id(req: Request, name: string): bigint {
  try { return idFromRoute(req.params[name]); }
  catch { throw new CustomerError(400, "INVALID_ID", "Identificador inválido."); }
}

function endpoint(action: (req: Request) => Promise<unknown>, status = 200): RequestHandler {
  return async (req, res) => {
    try {
      const data = await action(req);
      res.status(status).json({ ok: true, data: jsonSafe(data) });
    } catch (error: unknown) {
      if (error instanceof CustomerError) {
        res.status(error.status).json({ ok: false, code: error.code, message: error.message });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({
          ok: false, code: "CUSTOMER_VALIDATION_ERROR", message: "Datos inválidos.",
          errors: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
        });
        return;
      }
      if (isUniqueViolation(error)) {
        res.status(409).json({ ok: false, code: "CUSTOMER_DUPLICATE_CODE", message: "El código de cliente ya existe en esta empresa." });
        return;
      }
      console.error("[customers]", error);
      res.status(500).json({ ok: false, code: "CUSTOMER_INTERNAL_ERROR", message: "No fue posible procesar la solicitud." });
    }
  };
}

customerRouter.get("/", requirePermission("CLIENTES.VER"), endpoint(async (req) =>
  customerService.list(actorOf(req), customerListSchema.parse(req.query))));

customerRouter.post("/", requirePermission("CLIENTES.CREAR"), endpoint(async (req) =>
  customerService.create(actorOf(req), createCustomerSchema.parse(req.body)), 201));

customerRouter.get("/:customerId", requirePermission("CLIENTES.VER"), endpoint(async (req) =>
  customerService.get(actorOf(req), id(req, "customerId"))));

customerRouter.patch("/:customerId", requirePermission("CLIENTES.EDITAR"), endpoint(async (req) =>
  customerService.update(actorOf(req), id(req, "customerId"), updateCustomerSchema.parse(req.body))));

customerRouter.get("/:customerId/addresses", requirePermission("CLIENTES.VER"), endpoint(async (req) =>
  customerService.addresses(actorOf(req), id(req, "customerId"))));

customerRouter.post("/:customerId/addresses", requirePermission("CLIENTES.EDITAR"), endpoint(async (req) =>
  customerService.createAddress(actorOf(req), id(req, "customerId"), createCustomerAddressSchema.parse(req.body)), 201));

customerRouter.patch("/:customerId/addresses/:addressId", requirePermission("CLIENTES.EDITAR"), endpoint(async (req) =>
  customerService.updateAddress(actorOf(req), id(req, "customerId"), id(req, "addressId"), updateCustomerAddressSchema.parse(req.body))));

customerRouter.delete("/:customerId/addresses/:addressId", requirePermission("CLIENTES.EDITAR"), endpoint(async (req) =>
  customerService.deleteAddress(actorOf(req), id(req, "customerId"), id(req, "addressId"))));
