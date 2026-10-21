import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { quoteController } from './controllers/quote.controller.js';

export const quoteRouter = Router();
quoteRouter.use(requireAuth);
quoteRouter.get('/', requirePermission('COTIZACIONES.VER'), quoteController.list);
quoteRouter.get('/:id', requirePermission('COTIZACIONES.VER'), quoteController.get);
quoteRouter.post('/', requirePermission('COTIZACIONES.CREAR'), quoteController.create);
quoteRouter.patch('/:id', requirePermission('COTIZACIONES.CREAR'), quoteController.update);
quoteRouter.post('/:id/send', requirePermission('COTIZACIONES.CREAR'), quoteController.send);
quoteRouter.post('/:id/accept', requirePermission('COTIZACIONES.CREAR'), quoteController.accept);
quoteRouter.post('/:id/reject', requirePermission('COTIZACIONES.CREAR'), quoteController.reject);
quoteRouter.post('/:id/cancel', requirePermission('COTIZACIONES.CREAR'), quoteController.cancel);
quoteRouter.post('/:id/expire', requirePermission('COTIZACIONES.CREAR'), quoteController.expire);
// CONVERTIDA / convertir a venta: intencionalmente no implementado en esta fase.
