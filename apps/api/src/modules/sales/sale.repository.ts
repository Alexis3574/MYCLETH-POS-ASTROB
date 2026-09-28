import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

export type SaleTransaction = Prisma.TransactionClient;

type DecimalInput = string | number;

interface CreateSaleData {
  empresa_id: bigint;
  sucursal_id: bigint;
  almacen_id: bigint;
  cliente_id?: bigint | null;
  usuario_id: bigint;
  sesion_caja_id?: bigint | null;
  folio: string;
  estado: string;
  subtotal: DecimalInput;
  descuento: DecimalInput;
  impuesto: DecimalInput;
  total: DecimalInput;
  observaciones?: string | null;
}

interface CreateSaleDetailData {
  venta_id: bigint;
  producto_id: bigint;
  descripcion?: string | null;
  cantidad: DecimalInput;
  precio_unitario: DecimalInput;
  costo_unitario?: DecimalInput | null;
  descuento_porcentaje: DecimalInput;
  tasa_impuesto: DecimalInput;
  subtotal_linea: DecimalInput;
  descuento_importe: DecimalInput;
  impuesto_importe: DecimalInput;
  total_linea: DecimalInput;
}

interface CreateInventoryMovementData {
  productoId: bigint;
  almacenId: bigint;
  usuarioId: bigint;
  cantidad: DecimalInput;
  costoUnitario?: DecimalInput | null;
  ventaId: bigint;
  ventaDetalleId: bigint;
}

export const saleRepository = {
  async transaction<T>(
    callback: (tx: SaleTransaction) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(callback);
  },

  async createSale(
    tx: SaleTransaction,
    data: CreateSaleData,
  ) {
    return tx.venta.create({
      data,
    });
  },

  async createDetail(
    tx: SaleTransaction,
    data: CreateSaleDetailData,
  ) {
    return tx.venta_detalle.create({
      data,
    });
  },

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
        unidad_medida: {
          select: {
            permite_decimales: true,
          },
        },
      },
    });
  },

  async createInventoryMovement(
    tx: SaleTransaction,
    {
      productoId,
      almacenId,
      usuarioId,
      cantidad,
      costoUnitario,
      ventaId,
      ventaDetalleId,
    }: CreateInventoryMovementData,
  ) {
    return tx.movimiento_inventario.create({
      data: {
        producto_id: productoId,
        almacen_id: almacenId,
        usuario_id: usuarioId,
        tipo: "SALIDA",
        cantidad,
        costo_unitario: costoUnitario ?? null,
        documento_tipo: "VENTA",
        documento_id: ventaId,
        documento_detalle_id: ventaDetalleId,
        motivo: "Venta",
      },
    });
  },

  async completeSale(
    tx: SaleTransaction,
    saleId: bigint,
  ) {
    return tx.venta.update({
      where: {
        id: saleId,
      },
      data: {
        estado: "COMPLETADA",
        actualizado_en: new Date(),
      },
    });
  },
};