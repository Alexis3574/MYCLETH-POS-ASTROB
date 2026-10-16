import type {
  SaleTransaction,
} from "../../types/sales.types.js";

interface CreateReturnInventoryMovementData {
  productoId: bigint;
  almacenId: bigint;
  usuarioId: bigint;
  cantidad: number;
  costoUnitario?: number | null;
  returnId: bigint;
  returnDetailId: bigint;
  motivo: string;
}

export const saleReturnInventoryRepository = {
  async createStockIn(
    tx: SaleTransaction,
    data: CreateReturnInventoryMovementData,
  ) {
    return tx.movimiento_inventario.create({
      data: {
        producto_id:
          data.productoId,

        almacen_id:
          data.almacenId,

        usuario_id:
          data.usuarioId,

        tipo:
          "ENTRADA",

        cantidad:
          data.cantidad,

        costo_unitario:
          data.costoUnitario ??
          null,

        documento_tipo:
          "DEVOLUCION_VENTA",

        documento_id:
          data.returnId,

        documento_detalle_id:
          data.returnDetailId,

        motivo:
          data.motivo,
      },

      select: {
        id: true,
      },
    });
  },
};