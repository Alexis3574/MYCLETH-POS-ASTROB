import type { PurchaseAction, PurchaseActor, PurchaseTx } from '../types/purchase.types.js';
import { purchaseError } from '../errors/purchase.errors.js';

interface OperationRecord {
  usuario_id: bigint;
  accion: string;
  request_hash: string;
  respuesta: unknown;
}

export const purchaseOperationRepository = {
  async replay(tx: PurchaseTx, actor: PurchaseActor, action: PurchaseAction, key: string, hash: string) {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`pos-purchase:${actor.empresaId}:${key}`}, 0))`;
    const rows = await tx.$queryRaw<OperationRecord[]>`
      SELECT usuario_id, accion, request_hash, respuesta
      FROM pos.operacion_compra
      WHERE empresa_id = ${actor.empresaId} AND clave_idempotencia = ${key}
    `;
    const existing = rows[0];
    if (!existing) return null;
    if (existing.usuario_id !== actor.userId || existing.accion !== action || existing.request_hash !== hash) {
      throw purchaseError.conflict('PURCHASE_IDEMPOTENCY_CONFLICT', 'La clave de idempotencia se reutilizó para otra solicitud o usuario.');
    }
    return existing.respuesta;
  },
  async persist(tx: PurchaseTx, actor: PurchaseActor, action: PurchaseAction, purchaseId: bigint, key: string, hash: string, response: unknown) {
    await tx.$executeRaw`
      INSERT INTO pos.operacion_compra
        (empresa_id, usuario_id, compra_id, accion, clave_idempotencia, request_hash, respuesta)
      VALUES (${actor.empresaId}, ${actor.userId}, ${purchaseId}, ${action}, ${key}, ${hash}, ${JSON.stringify(response)}::jsonb)
    `;
  },
  audit(tx: PurchaseTx, actor: PurchaseActor, purchaseId: bigint, action: PurchaseAction, details: unknown) {
    return tx.auditoria.create({ data: {
      usuario_id: actor.userId, tabla: 'compra', registro_id: purchaseId,
      accion: action === 'CREAR' ? 'INSERT' : 'UPDATE',
      datos_nuevos: JSON.parse(JSON.stringify({ accion: action, detalle: details })),
    } });
  },
};
