import { z } from 'zod';
import type { Request, RequestHandler } from 'express';
import { purchaseError, PurchaseError } from '../errors/purchase.errors.js';
import { purchaseService } from '../services/purchase.service.js';
import { purchaseCancelSchema, purchaseCreateSchema, purchaseKeySchema, purchaseListSchema, purchasePaymentSchema } from '../purchase.schema.js';
import { parsePositiveId } from '../utils/purchase-values.js';
import type { PurchaseActor } from '../types/purchase.types.js';

function actorOf(req: Request): PurchaseActor {
  if (!req.auth) throw new PurchaseError(401, 'PURCHASE_AUTH_REQUIRED', 'Autenticación requerida.');
  return { empresaId: req.auth.empresaId, userId: req.auth.userId };
}
function purchaseId(req: Request): bigint {
  const id = parsePositiveId(req.params.id);
  if (id === null) throw new PurchaseError(400, 'PURCHASE_INVALID_ID', 'ID de compra inválido.');
  return id;
}
function keyOf(req: Request): string {
  const value = req.header('Idempotency-Key');
  const parsed = purchaseKeySchema.safeParse(value);
  if (!parsed.success) throw new PurchaseError(400, 'PURCHASE_IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key UUID válido obligatorio.');
  return parsed.data;
}
function endpoint(operation: (req: Request) => Promise<unknown>, status = 200): RequestHandler {
  return async (req, res) => {
    try {
      const result = await operation(req);
      res.status(status).json({ ok: true, data: result });
    } catch (error: unknown) {
      if (error instanceof PurchaseError) {
        res.status(error.status).json({ ok: false, code: error.code, message: error.message });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({ ok: false, code: 'PURCHASE_VALIDATION_ERROR',
          message: 'Datos de compra inválidos.',
          errors: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })) });
        return;
      }
      console.error('[purchases]', error);
      res.status(500).json({ ok: false, code: 'PURCHASE_INTERNAL_ERROR', message: 'Error interno procesando la compra.' });
    }
  };
}

export const purchaseController = {
  list: endpoint((req) => purchaseService.list(actorOf(req), purchaseListSchema.parse(req.query))),
  get: endpoint((req) => purchaseService.get(actorOf(req), purchaseId(req))),
  create: endpoint((req) => purchaseService.create(actorOf(req), purchaseCreateSchema.parse(req.body), keyOf(req)), 201),
  receive: endpoint((req) => purchaseService.receive(actorOf(req), purchaseId(req), keyOf(req))),
  pay: endpoint((req) => purchaseService.pay(actorOf(req), purchaseId(req), keyOf(req), purchasePaymentSchema.parse(req.body)), 201),
  cancel: endpoint((req) => purchaseService.cancel(actorOf(req), purchaseId(req), keyOf(req), purchaseCancelSchema.parse(req.body).motivo)),
};
