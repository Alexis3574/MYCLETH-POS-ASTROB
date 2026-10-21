import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { quoteErrors, QuoteError } from '../errors/quote.errors.js';
import { quoteActionSchema, quoteCreateSchema, quoteIdSchema, quoteListSchema, quoteUpdateSchema } from '../quote.schema.js';
import { quoteService } from '../services/quote.service.js';
import type { QuoteAction, QuoteActor } from '../types/quote.types.js';

function actor(req: Request): QuoteActor {
  if (!req.auth) throw new QuoteError(401, 'QUOTE_AUTH_REQUIRED', 'Autenticación requerida.');
  return { empresaId: req.auth.empresaId, userId: req.auth.userId };
}
function id(req: Request): bigint {
  return quoteIdSchema.parse(req.params.id);
}
function endpoint(operation: (req: Request) => Promise<unknown>, status = 200): RequestHandler {
  return async (req, res) => {
    try {
      const data = await operation(req);
      res.status(status).json({ ok: true, data });
    } catch (error: unknown) {
      if (error instanceof QuoteError) {
        res.status(error.status).json({ ok: false, code: error.code, message: error.message });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({ ok: false, code: 'QUOTE_VALIDATION_ERROR', message: 'Datos de cotización inválidos.',
          errors: error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })) });
        return;
      }
      console.error('[quotes]', error);
      res.status(500).json({ ok: false, code: 'QUOTE_INTERNAL_ERROR', message: 'Error interno procesando cotizaciones.' });
    }
  };
}
const action = (name: QuoteAction) => endpoint(req => {
  quoteActionSchema.parse(req.body ?? {});
  return quoteService.changeState(actor(req), id(req), name);
});

export const quoteController = {
  list: endpoint(req => quoteService.list(actor(req), quoteListSchema.parse(req.query))),
  get: endpoint(req => quoteService.get(actor(req), id(req))),
  create: endpoint(req => quoteService.create(actor(req), quoteCreateSchema.parse(req.body)), 201),
  update: endpoint(req => quoteService.update(actor(req), id(req), quoteUpdateSchema.parse(req.body))),
  send: action('send'),
  accept: action('accept'),
  reject: action('reject'),
  cancel: action('cancel'),
  expire: action('expire'),
};
