import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { customerOrderController } from './controllers/customer-order.controller.js';

export const customerOrderRouter = Router();
customerOrderRouter.use(requireAuth);
customerOrderRouter.get('/', requirePermission('PEDIDOS.VER'), customerOrderController.list);
customerOrderRouter.get('/:id', requirePermission('PEDIDOS.VER'), customerOrderController.get);
customerOrderRouter.post('/', requirePermission('PEDIDOS.CREAR'), customerOrderController.create);
customerOrderRouter.patch('/:id', requirePermission('PEDIDOS.CREAR'), customerOrderController.update);
customerOrderRouter.post('/:id/confirm', requirePermission('PEDIDOS.CREAR'), customerOrderController.confirm);
customerOrderRouter.post('/:id/prepare', requirePermission('PEDIDOS.CREAR'), customerOrderController.prepare);
customerOrderRouter.post('/:id/ready', requirePermission('PEDIDOS.CREAR'), customerOrderController.ready);
customerOrderRouter.post('/:id/deliver', requirePermission('PEDIDOS.CREAR'), customerOrderController.deliver);
customerOrderRouter.post('/:id/cancel', requirePermission('PEDIDOS.CREAR'), customerOrderController.cancel);
customerOrderRouter.post('/:id/convert-to-sale', requirePermission('PEDIDOS.CREAR'),
  requirePermission('VENTAS.CREAR'), customerOrderController.convertToSale);
