import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { orderController } from './controllers/order.controller.js';

export const orderRouter = Router();
orderRouter.use(requireAuth);
orderRouter.get('/', requirePermission('ORDENES.VER'), orderController.list);
orderRouter.get('/:id', requirePermission('ORDENES.VER'), orderController.get);
orderRouter.post('/', requirePermission('ORDENES.CREAR'), orderController.create);
orderRouter.patch('/:id', requirePermission('ORDENES.CREAR'), orderController.update);
orderRouter.post('/:id/start', requirePermission('ORDENES.CREAR'), orderController.start);
orderRouter.post('/:id/ready', requirePermission('ORDENES.CREAR'), orderController.ready);
orderRouter.post('/:id/cancel', requirePermission('ORDENES.CREAR'), orderController.cancel);
orderRouter.post('/:id/convert-to-sale', requirePermission('ORDENES.CREAR'),
  requirePermission('VENTAS.CREAR'), orderController.convertToSale);

export const orderQuoteRouter = Router();
orderQuoteRouter.use(requireAuth);
orderQuoteRouter.post('/:id/convert-to-order',
  requirePermission('COTIZACIONES.CREAR'),
  requirePermission('ORDENES.CREAR'),
  orderController.fromQuote);
