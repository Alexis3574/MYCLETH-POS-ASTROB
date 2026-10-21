import type { Request, RequestHandler } from "express";
import { z } from "zod";
import { organizationService } from "../services/organization.service.js";
import { OrganizationError, isDatabaseConflict } from "../errors/organization.errors.js";
import { serializeOrganization } from "../utils/organization-values.js";
import type { OrganizationActor } from "../types/organization.types.js";
import {
  organizationIdSchema, companyUpdateSchema, branchCreateSchema, branchUpdateSchema,
  branchListSchema, warehouseCreateSchema, warehouseUpdateSchema, warehouseListSchema,
  assignmentCreateSchema,
} from "../organization.schema.js";
function actor(req: Request): OrganizationActor {
  if (!req.auth) throw new OrganizationError(401, "ORGANIZATION_AUTH", "Autenticación requerida.");
  return { empresaId: req.auth.empresaId, userId: req.auth.userId };
}
function id(req: Request, name: string): bigint {
  const result = organizationIdSchema.safeParse(req.params[name]);
  if (!result.success) throw new OrganizationError(400, "ORGANIZATION_ID", "Identificador inválido.");
  return result.data;
}
function endpoint(fn: (req: Request) => Promise<unknown>, status = 200): RequestHandler {
  return async (req, res) => {
    try {
      res.status(status).json({ ok: true, data: serializeOrganization(await fn(req)) });
    } catch (error: unknown) {
      if (error instanceof OrganizationError) {
        res.status(error.status).json({ ok: false, code: error.code, message: error.message });
      } else if (error instanceof z.ZodError) {
        res.status(400).json({ ok: false, code: "ORGANIZATION_VALIDATION", message: "Datos inválidos.",
          errors: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })) });
      } else if (isDatabaseConflict(error, "P2002") || isDatabaseConflict(error, "23505")) {
        res.status(409).json({ ok: false, code: "ORGANIZATION_DUPLICATE", message: "Código o dato único duplicado." });
      } else if (isDatabaseConflict(error, "P2003") || isDatabaseConflict(error, "23503")) {
        res.status(409).json({ ok: false, code: "ORGANIZATION_REFERENCE", message: "La operación afecta una relación protegida." });
      } else if (isDatabaseConflict(error, "P2034") || isDatabaseConflict(error, "40001") || isDatabaseConflict(error, "40P01")) {
        res.status(409).json({ ok: false, code: "ORGANIZATION_RETRY", message: "Conflicto concurrente: repita la operación." });
      } else {
        console.error("[organization]", error);
        res.status(500).json({ ok: false, code: "ORGANIZATION_INTERNAL", message: "Error interno." });
      }
    }
  };
}
export const organizationController = {
  company: endpoint((req) => organizationService.company(actor(req))),
  updateCompany: endpoint((req) => organizationService.updateCompany(actor(req), companyUpdateSchema.parse(req.body))),
  branches: endpoint((req) => organizationService.branches(actor(req), branchListSchema.parse(req.query))),
  branch: endpoint((req) => organizationService.branch(actor(req), id(req, "branchId"))),
  createBranch: endpoint((req) => organizationService.createBranch(actor(req), branchCreateSchema.parse(req.body)), 201),
  updateBranch: endpoint((req) => organizationService.updateBranch(actor(req), id(req, "branchId"), branchUpdateSchema.parse(req.body))),
  warehouses: endpoint((req) => organizationService.warehouses(actor(req), warehouseListSchema.parse(req.query))),
  warehouse: endpoint((req) => organizationService.warehouse(actor(req), id(req, "warehouseId"))),
  createWarehouse: endpoint((req) => organizationService.createWarehouse(actor(req), warehouseCreateSchema.parse(req.body)), 201),
  updateWarehouse: endpoint((req) => organizationService.updateWarehouse(actor(req), id(req, "warehouseId"), warehouseUpdateSchema.parse(req.body))),
  branchUsers: endpoint((req) => organizationService.branchUsers(actor(req), id(req, "branchId"))),
  assignBranchUser: endpoint((req) => organizationService.assignBranchUser(actor(req), id(req, "branchId"), assignmentCreateSchema.parse(req.body)), 201),
  unassignBranchUser: endpoint((req) => organizationService.unassignBranchUser(actor(req), id(req, "branchId"), id(req, "userId"))),
};
