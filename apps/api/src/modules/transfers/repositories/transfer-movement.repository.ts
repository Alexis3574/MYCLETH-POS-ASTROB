import type { TransferTransaction } from "../types/transfer.types.js";

export const transferMovementRepository = {
  list(tx: TransferTransaction, empresaId: bigint, transferId: bigint) {
    return tx.movimiento_inventario.findMany({ where: { documento_tipo: "TRANSFERENCIA", documento_id: transferId,
      producto: { empresa_id: empresaId }, almacen: { sucursal: { empresa_id: empresaId } } },
      orderBy: { id: "asc" }, select: { id: true, producto_id: true, almacen_id: true, usuario_id: true,
        tipo: true, cantidad: true, costo_unitario: true, documento_detalle_id: true, fecha: true } });
  },
  countAll(tx: TransferTransaction, transferId: bigint) {
    return tx.movimiento_inventario.count({ where: { documento_tipo: "TRANSFERENCIA", documento_id: transferId } });
  },
  complete(tx: TransferTransaction, transferId: bigint, userId: bigint) {
    return tx.$executeRaw`CALL pos.sp_completar_transferencia(${transferId}::bigint, ${userId}::bigint)`;
  },
};
