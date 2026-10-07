import {
  createSaleReturnStockInSync,
} from "../../../inventory-sync/sale-return-inventory-sync.factory.js";

import {
  saleAuditRepository,
} from "../../repositories/sale-audit.repository.js";

import {
  saleReturnInventoryRepository,
} from "../repositories/sale-return-inventory.repository.js";

import {
  saleReturnPaymentRepository,
} from "../repositories/sale-return-payment.repository.js";

import {
  saleReturnRepository,
} from "../repositories/sale-return.repository.js";

import type {
  LockedReturnSale,
} from "../repositories/sale-return.repository.js";

import type {
  CreateSaleReturnInput,
} from "../types/sale-return.types.js";

import type {
  PreparedReturnItem,
  ReturnTotals,
} from "../validators/sale-return-items.validator.js";

import type {
  PreparedReturnRefund,
} from "../validators/sale-return-payments.validator.js";

import type {
  SaleTransaction,
} from "../../types/sales.types.js";

import {
  decimalToNumber,
} from "../../utils/sale-money.js";

interface PersistReturnParams {
  tx:
    SaleTransaction;

  sale:
    LockedReturnSale;

  input:
    CreateSaleReturnInput;

  items:
    PreparedReturnItem[];

  refunds:
    PreparedReturnRefund[];

  totals:
    ReturnTotals;
}

export async function persistSaleReturn({
  tx,
  sale,
  input,
  items,
  refunds,
  totals,
}: PersistReturnParams) {
  const cashSessionId =
    refunds.find(
      (refund) =>
        refund.salePayment
          .metodo_pago
          .es_efectivo,
    )?.sesionCajaId ??
    null;

  const createdReturn =
    await saleReturnRepository
      .createReturn(
        tx,
        {
          ventaId:
            sale.id,

          usuarioId:
            input.usuarioId,

          sesionCajaId:
            cashSessionId,

          folio:
            input.folio,

          motivo:
            input.motivo,

          subtotal:
            totals.subtotal,

          descuento:
            totals.descuento,

          impuesto:
            totals.impuesto,

          total:
            totals.total,
        },
      );

  const createdDetails =
    [];

  for (
    const item of
    items
  ) {
    const createdDetail =
      await saleReturnRepository
        .createReturnDetail(
          tx,
          {
            devolucionVentaId:
              createdReturn.id,

            ventaDetalleId:
              item.saleDetail.id,

            cantidad:
              item.cantidad,

            subtotalLinea:
              item.subtotalLinea,

            descuentoImporte:
              item.descuentoImporte,

            impuestoImporte:
              item.impuestoImporte,

            totalLinea:
              item.totalLinea,
          },
        );

    if (
      item.saleDetail.producto
        .controla_inventario
    ) {
      const costoUnitario =
        item.saleDetail
          .costo_unitario ===
        null
          ? null
          : decimalToNumber(
              item.saleDetail
                .costo_unitario,
            );

      const movement =
        await saleReturnInventoryRepository
          .createStockIn(
            tx,
            {
              productoId:
                item.saleDetail
                  .producto_id,

              almacenId:
                sale.almacen_id,

              usuarioId:
                input.usuarioId,

              cantidad:
                item.cantidad,

              costoUnitario,

              returnId:
                createdReturn.id,

              returnDetailId:
                createdDetail.id,

              motivo:
                `Devolución de venta ${sale.folio}`,
            },
          );

      await createSaleReturnStockInSync({
        tx,

        movimientoInventarioId:
          movement.id,

        returnId:
          createdReturn.id,

        returnDetailId:
          createdDetail.id,

        codigoBarras:
          item.saleDetail
            .producto
            .codigo_barras,

        sku:
          item.saleDetail
            .producto
            .sku,

        quantity:
          item.cantidad,
      });
    }

    createdDetails.push({
      id:
        createdDetail.id
          .toString(),

      venta_detalle_id:
        createdDetail
          .venta_detalle_id
          .toString(),

      cantidad:
        decimalToNumber(
          createdDetail.cantidad,
        ),

      total_linea:
        decimalToNumber(
          createdDetail
            .total_linea,
        ),
    });
  }

  const createdRefunds =
    [];

  for (
    const refund of
    refunds
  ) {
    const createdRefund =
      await saleReturnPaymentRepository
        .createRefund(
          tx,
          {
            devolucionVentaId:
              createdReturn.id,

            ventaPagoId:
              refund.salePayment.id,

            sesionCajaId:
              refund.sesionCajaId,

            monto:
              refund.monto,

            referencia:
              refund.referencia,
          },
        );

    if (
      refund.salePayment
        .metodo_pago
        .es_efectivo
    ) {
      if (
        refund.sesionCajaId ===
        null
      ) {
        throw new Error(
          "No se encontró una sesión de caja válida para el reembolso.",
        );
      }

      await saleReturnPaymentRepository
        .createCashMovement(
          tx,
          {
            sesionCajaId:
              refund.sesionCajaId,

            usuarioId:
              input.usuarioId,

            monto:
              refund.monto,

            concepto:
              `Reembolso efectivo devolución ${createdReturn.folio}`,

            referencia:
              `DEVOLUCION:${createdReturn.id.toString()}:PAGO:${createdRefund.id.toString()}`,
          },
        );
    }

    createdRefunds.push({
      id:
        createdRefund.id
          .toString(),

      venta_pago_id:
        createdRefund
          .venta_pago_id
          .toString(),

      metodo_pago:
        refund.salePayment
          .metodo_pago
          .codigo,

      es_efectivo:
        refund.salePayment
          .metodo_pago
          .es_efectivo,

      monto:
        decimalToNumber(
          createdRefund.monto,
        ),

      referencia:
        createdRefund.referencia,
    });
  }

  await saleAuditRepository.create(
    tx,
    {
      usuarioId:
        input.usuarioId,

      tabla:
        "devolucion_venta",

      registroId:
        createdReturn.id,

      accion:
        "INSERT",

      datosNuevos: {
        venta_id:
          sale.id.toString(),

        folio:
          createdReturn.folio,

        total:
          totals.total,
      },

      ipOrigen:
        input.ipOrigen ??
        null,
    },
  );

  return {
    id:
      createdReturn.id
        .toString(),

    venta_id:
      createdReturn.venta_id
        .toString(),

    folio:
      createdReturn.folio,

    motivo:
      createdReturn.motivo,

    subtotal:
      decimalToNumber(
        createdReturn.subtotal,
      ),

    descuento:
      decimalToNumber(
        createdReturn.descuento,
      ),

    impuesto:
      decimalToNumber(
        createdReturn.impuesto,
      ),

    total:
      decimalToNumber(
        createdReturn.total,
      ),

    fecha:
      createdReturn.fecha,

    detalles:
      createdDetails,

    reembolsos:
      createdRefunds,
  };
}
