import type { TransferActor, TransferTransaction } from "../types/transfer.types.js";
import { inventoryContextRepository } from "../../inventory/repositories/inventory-context.repository.js";

export const transferContextRepository = {
  findWarehouse: inventoryContextRepository.findWarehouse,
  findProduct: inventoryContextRepository.findProduct,
  lockWarehouse: inventoryContextRepository.lockWarehouse,
  async lockActor(tx: TransferTransaction, actor: TransferActor) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT u.id FROM pos.usuario u JOIN pos.empresa e ON e.id = u.empresa_id
      WHERE u.id = ${actor.userId} AND u.empresa_id = ${actor.empresaId}
        AND u.activo AND NOT u.bloqueado AND e.activo FOR SHARE OF u, e
    `;
    return rows.length === 1;
  },
  async canTransfer(tx: TransferTransaction, userId: bigint) {
    return Boolean(await tx.usuario_rol.findFirst({ where: { usuario_id: userId,
      rol: { activo: true, rol_permiso: { some: { permiso: { codigo: "INVENTARIO.TRANSFERIR" } } } } },
      select: { usuario_id: true } }));
  },
  async lockProduct(tx: TransferTransaction, empresaId: bigint, productId: bigint) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT p.id FROM pos.producto p JOIN pos.unidad_medida u ON u.id = p.unidad_medida_id
      WHERE p.id = ${productId} AND p.empresa_id = ${empresaId}
      FOR NO KEY UPDATE OF p FOR SHARE OF u
    `;
    return rows.length === 1;
  },
};
