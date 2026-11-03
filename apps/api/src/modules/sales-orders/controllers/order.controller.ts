import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { OrderError } from '../errors/order.errors.js';
import {
  orderActionSchema, orderCreateSchema, orderFromQuoteSchema, orderIdSchema,
  orderListSchema, orderUpdateSchema,
} from '../order.schema.js';
import { orderService } from '../services/order.service.js';
import { orderConvertToSaleSchema } from '../order-conversion.schema.js';
import { convertOrderToSale } from '../services/order-to-sale.service.js';
import type { OrderAction, OrderActor } from '../types/order.types.js';

function actor(req: Request): OrderActor {
  if (!req.auth) throw new OrderError(401, 'ORDER_AUTH_REQUIRED', 'Autenticación requerida.');
  return { empresaId: req.auth.empresaId, userId: req.auth.userId };
}

function id(req: Request): bigint {
  return orderIdSchema.parse(req.params.id);
}

function handler(operation: (req: Request) => Promise<unknown>, successStatus = 200): RequestHandler {
  return async (req, res) => {
    try {
      const data = await operation(req);
      res.status(successStatus).json({ ok: true, data });
    } catch (error: unknown) {
      if (error instanceof OrderError) {
        res.status(error.status).json({ ok: false, code: error.code, message: error.message });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({ ok: false, code: 'ORDER_VALIDATION_ERROR', message: 'Datos de orden inválidos.',
          errors: error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })) });
        return;
      }
      console.error('[sales-orders]', error);
      res.status(500).json({ ok: false, code: 'ORDER_INTERNAL_ERROR', message: 'Error interno procesando órdenes.' });
    }
  };
}

const action = (name: OrderAction) => handler(req => {
  orderActionSchema.parse(req.body ?? {});
  return orderService.changeState(actor(req), id(req), name);
});

export const orderController = {
  list: handler(req => orderService.list(actor(req), orderListSchema.parse(req.query))),
  get: handler(req => orderService.get(actor(req), id(req))),
  create: handler(req => orderService.create(actor(req), orderCreateSchema.parse(req.body)), 201),
  update: handler(req => orderService.update(actor(req), id(req), orderUpdateSchema.parse(req.body))),
  start: action('start'),
  ready: action('ready'),
  cancel: action('cancel'),
  fromQuote: handler(req => orderService.fromQuote(actor(req), id(req), orderFromQuoteSchema.parse(req.body)), 201),
  convertToSale: handler(req => convertOrderToSale(actor(req), id(req),
    orderConvertToSaleSchema.parse(req.body)), 201),
};
