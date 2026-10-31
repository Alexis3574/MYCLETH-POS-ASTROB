import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { CustomerOrderError } from '../errors/customer-order.errors.js';
import {
  customerOrderIdSchema, customerOrderCreateSchema, customerOrderUpdateSchema,
  customerOrderListSchema, customerOrderActionSchema,
} from '../customer-order.schema.js';
import { customerOrderService } from '../services/customer-order.service.js';
import { customerOrderConvertToSaleSchema } from '../customer-order-conversion.schema.js';
import { convertCustomerOrderToSale } from '../services/customer-order-to-sale.service.js';
import type { CustomerOrderActor, CustomerOrderAction } from '../types/customer-order.types.js';

function actor(req: Request): CustomerOrderActor {
  if (!req.auth) throw new CustomerOrderError(401, 'CUSTOMER_ORDER_AUTH_REQUIRED', 'Autenticación requerida.');
  return { empresaId: req.auth.empresaId, userId: req.auth.userId };
}
function id(req: Request): bigint { return customerOrderIdSchema.parse(req.params.id); }

function handler(operation: (req: Request) => Promise<unknown>, successStatus = 200): RequestHandler {
  return async (req, res) => {
    try {
      const data = await operation(req);
      res.status(successStatus).json({ ok: true, data });
    } catch (error: unknown) {
      if (error instanceof CustomerOrderError) {
        res.status(error.status).json({ ok: false, code: error.code, message: error.message });
        return;
      }
      if (error instanceof z.ZodError) {
        res.status(400).json({ ok: false, code: 'CUSTOMER_ORDER_VALIDATION_ERROR',
          message: 'Datos de pedido inválidos.',
          errors: error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })) });
        return;
      }
      console.error('[customer-orders]', error);
      res.status(500).json({ ok: false, code: 'CUSTOMER_ORDER_INTERNAL_ERROR',
        message: 'Error interno procesando pedidos.' });
    }
  };
}

const action = (name: CustomerOrderAction) => handler(req => {
  customerOrderActionSchema.parse(req.body ?? {});
  return customerOrderService.changeState(actor(req), id(req), name);
});

export const customerOrderController = {
  list: handler(req => customerOrderService.list(actor(req), customerOrderListSchema.parse(req.query))),
  get: handler(req => customerOrderService.get(actor(req), id(req))),
  create: handler(req => customerOrderService.create(actor(req), customerOrderCreateSchema.parse(req.body)), 201),
  update: handler(req => customerOrderService.update(actor(req), id(req), customerOrderUpdateSchema.parse(req.body))),
  confirm: action('confirm'),
  prepare: action('prepare'),
  ready: action('ready'),
  deliver: action('deliver'),
  cancel: action('cancel'),
  convertToSale: handler(req => convertCustomerOrderToSale(actor(req), id(req),
    customerOrderConvertToSaleSchema.parse(req.body)), 201),
};
