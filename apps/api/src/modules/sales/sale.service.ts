import { createSaleStockOutSync } from "../inventory-sync/inventory-sync.factory.js";
import { saleRepository } from "./sale.repository.js";

type DecimalInput = string | number;

interface SaleDetailInput {
  productoId: bigint;
  descripcion?: string | null;
  cantidad: DecimalInput;
  precioUnitario: DecimalInput;
  costoUnitario?: DecimalInput | null;
  descuentoPorcentaje: DecimalInput;
  tasaImpuesto: DecimalInput;
  subtotalLinea: DecimalInput;
  descuentoImporte: DecimalInput;
  impuestoImporte: DecimalInput;
  totalLinea: DecimalInput;
}

interface CreateSaleInput {
  empresaId: bigint;
  sucursalId: bigint;
  almacenId: bigint;
  clienteId?: bigint | null;
  usuarioId: bigint;
  sesionCajaId?: bigint | null;
  folio: string;
  subtotal: DecimalInput;
  descuento: DecimalInput;
  impuesto: DecimalInput;
  total: DecimalInput;
  observaciones?: string | null;
  detalles: SaleDetailInput[];
}

export const saleService = {
  async createSale(input: CreateSaleInput) {
    if (input.detalles.length === 0) {
      throw new Error(
        "A sale must contain at least one detail",
      );
    }

    return saleRepository.transaction(async (tx) => {
      const sale = await saleRepository.createSale(
        tx,
        {
          empresa_id: input.empresaId,
          sucursal_id: input.sucursalId,
          almacen_id: input.almacenId,
          cliente_id: input.clienteId ?? null,
          usuario_id: input.usuarioId,
          sesion_caja_id:
            input.sesionCajaId ?? null,
          folio: input.folio,
          estado: "BORRADOR",
          subtotal: input.subtotal,
          descuento: input.descuento,
          impuesto: input.impuesto,
          total: input.total,
          observaciones:
            input.observaciones ?? null,
        },
      );

      for (const item of input.detalles) {
        const product =
          await saleRepository.findProduct(
            tx,
            input.empresaId,
            item.productoId,
          );

        if (!product) {
          throw new Error(
            `Product ${item.productoId.toString()} was not found or is inactive`,
          );
        }

        const quantity = Number(item.cantidad);

        if (
          !Number.isFinite(quantity) ||
          quantity <= 0
        ) {
          throw new Error(
            `Invalid quantity for product ${product.sku}`,
          );
        }

        if (
          !product.unidad_medida.permite_decimales &&
          !Number.isInteger(quantity)
        ) {
          throw new Error(
            `Product ${product.sku} does not allow decimal quantities`,
          );
        }

        const detail =
          await saleRepository.createDetail(
            tx,
            {
              venta_id: sale.id,
              producto_id: product.id,
              descripcion:
                item.descripcion ??
                product.nombre,
              cantidad: item.cantidad,
              precio_unitario:
                item.precioUnitario,
              costo_unitario:
                item.costoUnitario ?? null,
              descuento_porcentaje:
                item.descuentoPorcentaje,
              tasa_impuesto:
                item.tasaImpuesto,
              subtotal_linea:
                item.subtotalLinea,
              descuento_importe:
                item.descuentoImporte,
              impuesto_importe:
                item.impuestoImporte,
              total_linea:
                item.totalLinea,
            },
          );

        if (!product.controla_inventario) {
          continue;
        }

        if (!Number.isInteger(quantity)) {
          throw new Error(
            `Product ${product.sku} cannot currently be synchronized with the e-commerce because its quantity is decimal`,
          );
        }

        const movement =
          await saleRepository.createInventoryMovement(
            tx,
            {
              productoId: product.id,
              almacenId: input.almacenId,
              usuarioId: input.usuarioId,
              cantidad: item.cantidad,
              costoUnitario:
                item.costoUnitario ?? null,
              ventaId: sale.id,
              ventaDetalleId: detail.id,
            },
          );

        await createSaleStockOutSync({
          tx,
          movimientoInventarioId: movement.id,
          saleId: sale.id,
          saleDetailId: detail.id,
          codigoBarras:
            product.codigo_barras,
          sku: product.sku,
          quantity,
        });
      }

      const completedSale =
        await saleRepository.completeSale(
          tx,
          sale.id,
        );

      return {
        id: completedSale.id.toString(),
        folio: completedSale.folio,
        estado: completedSale.estado,
      };
    });
  },
};