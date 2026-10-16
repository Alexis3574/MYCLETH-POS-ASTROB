import type { TransferTransaction } from "../types/transfer.types.js";
import { inventoryStockRepository } from "../../inventory/repositories/inventory-stock.repository.js";

export const transferStockRepository = {
  lock: inventoryStockRepository.lock,
  find: inventoryStockRepository.find,
  async ensureDestination(tx: TransferTransaction, productId: bigint, warehouseId: bigint) {
    await tx.$executeRaw`
      INSERT INTO pos.existencia (producto_id, almacen_id, cantidad, reservado, costo_promedio)
      VALUES (${productId}, ${warehouseId}, 0, 0, 0)
      ON CONFLICT (producto_id, almacen_id) DO NOTHING
    `;
  },
};
