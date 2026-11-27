import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { saleWriteRepository } from './repositories/sale.repository.js';
import { findSaleOperation } from './services/create/sale-operation.js';

export async function getSaleOperation(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) { res.status(401).json({ ok: false, message: 'Autenticación requerida.' }); return; }
    const key = z.string().uuid().transform(value => value.toLowerCase()).safeParse(req.params.key);
    if (!key.success) { res.status(400).json({ ok: false, message: 'Identificador de intento no válido.' }); return; }
    const actor = req.auth;
    const found = await saleWriteRepository.transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'pos-sale:' + actor.empresaId + ':' + key.data}, 0))`;
      return findSaleOperation(tx, actor.empresaId, key.data);
    });
    if (!found || found.usuario_id !== actor.userId) {
      res.status(404).json({ ok: false, message: 'No se encontró un resultado confirmado para este intento. No repitas la venta mientras pueda seguir procesándose.' }); return;
    }
    res.json({ ok: true, data: found.respuesta });
  } catch (error) { next(error); }
}
