import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requirePermission } from "../../middleware/permission.middleware.js";
import { CashError } from "./cash.errors.js";
import { cashService, type CashActor } from "./cash.service.js";
import {
  closeCashSchema,
  createCashSchema,
  idFromRoute,
  movementSchema,
  openCashSchema,
  paginationSchema,
  updateCashSchema,
} from "./cash.schema.js";
import { jsonSafe } from "./cash.utils.js";

export const cashRouter = Router();
cashRouter.use(requireAuth);

function actorOf(req: Request): CashActor {
  if (!req.auth) throw new CashError(401, "AUTH_REQUIRED", "Autenticación requerida.");
  return { empresaId: req.auth.empresaId, userId: req.auth.userId };
}

const id = (req: Request, name: string) => {
  const value = req.params[name];
  if (value === undefined) throw new CashError(400, "INVALID_ID", "Identificador obligatorio.");
  try { return idFromRoute(value); }
  catch { throw new CashError(400, "INVALID_ID", "Identificador inválido."); }
};

function paging(req: Request) {
  return paginationSchema.parse(req.query);
}

function endpoint(action: (req: Request) => Promise<unknown>, status = 200): RequestHandler {
  return async (req, res) => {
    try {
      const result = await action(req);
      res.status(status).json({ ok: true, data: jsonSafe(result) });
    } catch (error: unknown) {
      if (error instanceof CashError) {
        res.status(error.status).json({ ok: false, code: error.code, message: error.message });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({
          ok: false,
          code: "CASH_VALIDATION_ERROR",
          message: "Datos inválidos.",
          errors: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
        });
        return;
      }
      // La restricción única parcial de PostgreSQL sigue siendo la última defensa contra doble apertura.
      if (isUniqueViolation(error)) {
        res.status(409).json({ ok: false, code: "CASH_CONFLICT", message: "El registro ya existe o se intentó abrir una segunda sesión." });
        return;
      }
      console.error("[cash]", error);
      res.status(500).json({ ok: false, code: "CASH_INTERNAL_ERROR", message: "Error interno al procesar la operación de caja." });
    }
  };
}


function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002";
}

cashRouter.get("/", requirePermission("CAJAS.VER"), endpoint(async (req) => {
  const { page, pageSize } = paging(req);
  const branch = req.query.sucursal_id;
  let branchId: bigint | undefined;
  if (branch !== undefined) {
    try { branchId = idFromRoute(branch); }
    catch { throw new CashError(400, "INVALID_ID", "sucursal_id inválido."); }
  }
  return cashService.list(actorOf(req), page, pageSize, branchId);
}));

cashRouter.post("/", requirePermission("CAJAS.CREAR"), endpoint(async (req) =>
  cashService.create(actorOf(req), createCashSchema.parse(req.body)), 201));

cashRouter.get("/sessions/:sessionId", requirePermission("CAJAS.VER"), endpoint(async (req) =>
  cashService.session(actorOf(req), id(req, "sessionId"))));

cashRouter.get("/sessions/:sessionId/movements", requirePermission("CAJAS.VER"), endpoint(async (req) => {
  const { page, pageSize } = paging(req);
  return cashService.movements(actorOf(req), id(req, "sessionId"), page, pageSize);
}));

cashRouter.post("/sessions/:sessionId/movements", requirePermission("CAJAS.MOVER"), endpoint(async (req) =>
  cashService.move(actorOf(req), id(req, "sessionId"), movementSchema.parse(req.body)), 201));

cashRouter.post("/sessions/:sessionId/close", requirePermission("CAJAS.CERRAR"), endpoint(async (req) =>
  cashService.close(actorOf(req), id(req, "sessionId"), closeCashSchema.parse(req.body))));

cashRouter.get("/:cashId", requirePermission("CAJAS.VER"), endpoint(async (req) =>
  cashService.get(actorOf(req), id(req, "cashId"))));

cashRouter.patch("/:cashId", requirePermission("CAJAS.EDITAR"), endpoint(async (req) =>
  cashService.update(actorOf(req), id(req, "cashId"), updateCashSchema.parse(req.body))));

cashRouter.get("/:cashId/sessions/current", requirePermission("CAJAS.VER"), endpoint(async (req) =>
  cashService.current(actorOf(req), id(req, "cashId"))));

cashRouter.get("/:cashId/sessions", requirePermission("CAJAS.VER"), endpoint(async (req) => {
  const { page, pageSize } = paging(req);
  return cashService.history(actorOf(req), id(req, "cashId"), page, pageSize);
}));

cashRouter.post("/:cashId/sessions", requirePermission("CAJAS.ABRIR"), endpoint(async (req) =>
  cashService.open(actorOf(req), id(req, "cashId"), openCashSchema.parse(req.body)), 201));
