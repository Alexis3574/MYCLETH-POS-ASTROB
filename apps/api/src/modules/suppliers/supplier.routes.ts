import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/permission.middleware.js";
import { SupplierError } from "./supplier.errors.js";
import { supplierService, type SupplierActor } from "./supplier.service.js";
import {
  createSupplierAddressSchema, createSupplierSchema, supplierListSchema,
  updateSupplierAddressSchema, updateSupplierSchema,
} from "./supplier.schema.js";
import { idFromRoute, isPrismaErrorCode, jsonSafe } from "./supplier.utils.js";

export const supplierRouter = Router();
supplierRouter.use(requireAuth);

function actorOf(req: Request): SupplierActor {
  if (!req.auth) throw new SupplierError(401, "AUTH_REQUIRED", "Autenticación requerida.");
  return { empresaId: req.auth.empresaId, userId: req.auth.userId };
}

function id(req: Request, name: string): bigint {
  try { return idFromRoute(req.params[name]); }
  catch { throw new SupplierError(400, "INVALID_ID", "Identificador inválido."); }
}

function endpoint(action: (req: Request) => Promise<unknown>, successStatus = 200): RequestHandler {
  return async (req, res) => {
    try {
      const result = await action(req);
      res.status(successStatus).json({ ok: true, data: jsonSafe(result) });
    } catch (error: unknown) {
      if (error instanceof SupplierError) {
        res.status(error.status).json({ ok: false, code: error.code, message: error.message });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({
          ok: false, code: "SUPPLIER_VALIDATION_ERROR", message: "Datos inválidos.",
          errors: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
        });
        return;
      }
      if (isPrismaErrorCode(error, "P2002")) {
        res.status(409).json({
          ok: false, code: "SUPPLIER_DUPLICATE_CODE",
          message: "Ya existe un proveedor con ese código en esta empresa.",
        });
        return;
      }
      if (isPrismaErrorCode(error, "P2003")) {
        res.status(409).json({
          ok: false, code: "SUPPLIER_RELATION_CONFLICT",
          message: "La operación afecta una relación protegida.",
        });
        return;
      }
      console.error("[suppliers]", error);
      res.status(500).json({
        ok: false, code: "SUPPLIER_INTERNAL_ERROR",
        message: "No fue posible procesar la solicitud.",
      });
    }
  };
}

supplierRouter.get("/", requirePermission("PROVEEDORES.VER"), endpoint(async (req) =>
  supplierService.list(actorOf(req), supplierListSchema.parse(req.query))));

supplierRouter.post("/", requirePermission("PROVEEDORES.CREAR"), endpoint(async (req) =>
  supplierService.create(actorOf(req), createSupplierSchema.parse(req.body)), 201));

supplierRouter.get("/:supplierId", requirePermission("PROVEEDORES.VER"), endpoint(async (req) =>
  supplierService.get(actorOf(req), id(req, "supplierId"))));

supplierRouter.patch("/:supplierId", requirePermission("PROVEEDORES.EDITAR"), endpoint(async (req) =>
  supplierService.update(actorOf(req), id(req, "supplierId"), updateSupplierSchema.parse(req.body))));

supplierRouter.get("/:supplierId/addresses", requirePermission("PROVEEDORES.VER"), endpoint(async (req) =>
  supplierService.addresses(actorOf(req), id(req, "supplierId"))));

supplierRouter.post("/:supplierId/addresses", requirePermission("PROVEEDORES.EDITAR"), endpoint(async (req) =>
  supplierService.createAddress(actorOf(req), id(req, "supplierId"), createSupplierAddressSchema.parse(req.body)), 201));

supplierRouter.patch("/:supplierId/addresses/:addressId", requirePermission("PROVEEDORES.EDITAR"), endpoint(async (req) =>
  supplierService.updateAddress(actorOf(req), id(req, "supplierId"), id(req, "addressId"), updateSupplierAddressSchema.parse(req.body))));

supplierRouter.delete("/:supplierId/addresses/:addressId", requirePermission("PROVEEDORES.EDITAR"), endpoint(async (req) =>
  supplierService.deleteAddress(actorOf(req), id(req, "supplierId"), id(req, "addressId"))));
