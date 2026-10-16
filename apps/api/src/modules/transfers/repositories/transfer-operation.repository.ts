import type { Prisma } from "../../../generated/prisma/client.js";
import type { TransferActor, TransferSnapshot, TransferTransaction } from "../types/transfer.types.js";
import type { TransferAction } from "../utils/transfer-values.js";

export const transferOperationRepository = {
  async lockKey(tx: TransferTransaction, empresaId: bigint, key: string) {
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`warehouse-transfer:${empresaId}:${key}`}, 0))
    `;
  },
  findByKey(tx: TransferTransaction, empresaId: bigint, key: string) {
    return tx.operacion_transferencia.findUnique({ where: { empresa_id_clave_idempotencia: { empresa_id: empresaId, clave_idempotencia: key } } });
  },
  persist(tx: TransferTransaction, actor: TransferActor, transferId: bigint, action: TransferAction, key: string, hash: string, response: TransferSnapshot) {
    return tx.operacion_transferencia.create({ data: {
      empresa_id: actor.empresaId, usuario_id: actor.userId, transferencia_id: transferId,
      accion: action, clave_idempotencia: key, request_hash: hash, respuesta: response as unknown as Prisma.InputJsonValue,
    } });
  },
  audit(tx: TransferTransaction, actor: TransferActor, response: TransferSnapshot, before: Prisma.InputJsonValue | null) {
    return tx.auditoria.create({ data: { usuario_id: actor.userId, tabla: "transferencia_almacen",
      registro_id: BigInt(response.transferencia.id), accion: response.operacion.accion === "CREAR" ? "INSERT" : "UPDATE",
      ...(before === null ? {} : { datos_anteriores: before }), datos_nuevos: response as unknown as Prisma.InputJsonValue } });
  },
  history(tx: TransferTransaction, empresaId: bigint, transferId: bigint) {
    return tx.operacion_transferencia.findMany({ where: { empresa_id: empresaId, transferencia_id: transferId },
      select: { id: true, usuario_id: true, accion: true, creado_en: true }, orderBy: [{ creado_en: "asc" }, { id: "asc" }] });
  },
};
