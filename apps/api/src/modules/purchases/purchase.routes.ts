import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { purchaseController } from './controllers/purchase.controller.js';

export const purchaseRouter = Router();
purchaseRouter.use(requireAuth);
purchaseRouter.get('/', requirePermission('COMPRAS.VER'), purchaseController.list);
purchaseRouter.get('/:id', requirePermission('COMPRAS.VER'), purchaseController.get);
purchaseRouter.post('/', requirePermission('COMPRAS.CREAR'), purchaseController.create);
purchaseRouter.post('/:id/receive', requirePermission('COMPRAS.CREAR'), purchaseController.receive);
purchaseRouter.post('/:id/payments', requirePermission('COMPRAS.CREAR'), purchaseController.pay);
purchaseRouter.post('/:id/cancel', requirePermission('COMPRAS.CANCELAR'), purchaseController.cancel);
