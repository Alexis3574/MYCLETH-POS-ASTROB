import type {
  CreateInventoryMovementData,
  SaleTransaction,
} from "../types/sales.types.js";

interface InventoryStockRow {
  cantidad: string;
  reservado: string;
  disponible: string | null;
}

export const saleInventoryRepository = {
  async findProduct(
    tx: SaleTransaction,
    empresaId: bigint,
    productoId: bigint,
  ) {
    return tx.producto.findFirst({
      where: {
        id: productoId,
        empresa_id: empresaId,
        activo: true,
      },
      select: {
        id: true,
        empresa_id: true,
        sku: true,
        codigo_barras: true,
        nombre: true,
        controla_inventario: true,
        precio_venta: true,
        costo_referencia: true,

        unidad_medida: {
          select: {
            permite_decimales: true,
          },
        },

        producto_impuesto: {
          select: {
            impuesto: {
              select: {
                empresa_id: true,
                tasa: true,
                activo: true,
              },
            },
          },
        },
      },
    });
  },

  async lockInventoryStock(
    tx: SaleTransaction,
    productoId: bigint,
    almacenId: bigint,
  ) {
    const rows =
      await tx.$queryRaw<
        InventoryStockRow[]
      >`
        SELECT
          cantidad::text AS cantidad,
          reservado::text AS reservado,
          disponible::text AS disponible
        FROM "pos"."existencia"
        WHERE producto_id = ${productoId}
          AND almacen_id = ${almacenId}
        FOR UPDATE
      `;

    return rows[0] ?? null;
  },

  async findSaleStockOutMovement(
    tx: SaleTransaction,
    saleId: bigint,
    saleDetailId: bigint,
    productoId: bigint,
    almacenId: bigint,
  ) {
    return tx.movimiento_inventario.findFirst({
      where: {
        producto_id: productoId,
        almacen_id: almacenId,
        tipo: "SALIDA",
        documento_tipo: "VENTA",
        documento_id: saleId,
        documento_detalle_id: saleDetailId,
      },
      select: {
        id: true,
        cantidad: true,
        costo_unitario: true,
      },
    });
  },

  async createInventoryMovement(
    tx: SaleTransaction,
    data: CreateInventoryMovementData,
  ) {
    return tx.movimiento_inventario.create({
      data: {
        producto_id: data.productoId,
        almacen_id: data.almacenId,
        usuario_id: data.usuarioId,
        tipo: data.tipo,
        cantidad: data.cantidad,
        costo_unitario:
          data.costoUnitario ?? null,

        documento_tipo: "VENTA",
        documento_id: data.ventaId,
        documento_detalle_id:
          data.ventaDetalleId,

        motivo: data.motivo,
      },
    });
  },
};