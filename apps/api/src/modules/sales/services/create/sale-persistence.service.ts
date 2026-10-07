import {
  createSaleStockOutSync,
} from "../../../inventory-sync/inventory-sync.factory.js";

import {
  SaleContextError,
} from "../../errors/sale.errors.js";

import {
  saleAuditRepository,
} from "../../repositories/sale-audit.repository.js";

import {
  saleInventoryRepository,
} from "../../repositories/sale-inventory.repository.js";

import {
  salePaymentRepository,
} from "../../repositories/sale-payment.repository.js";

import {
  saleWriteRepository,
} from "../../repositories/sale.repository.js";

import type {
  CreateSaleInput,
  SaleTransaction,
} from "../../types/sales.types.js";

import {
  decimalToNumber,
} from "../../utils/sale-money.js";

import type {
  PreparedSaleDetail,
} from "./sale-detail.preparer.js";

import type {
  PreparedSalePayment,
} from "./sale-payment.preparer.js";

import type {
  SaleTotals,
} from "./sale-totals.js";

interface PersistSaleInput {
  tx:
    SaleTransaction;

  input:
    CreateSaleInput;

  preparedDetails:
    PreparedSaleDetail[];

  preparedPayments:
    PreparedSalePayment[];

  condicionPago:
    "CONTADO" | "CREDITO";

  totals:
    SaleTotals;
}

interface CreatedPaymentResult {
  id:
    string;

  metodo_pago_id:
    string;

  codigo:
    string;

  nombre:
    string;

  es_efectivo:
    boolean;

  monto:
    number;

  referencia:
    string | null;

  fecha:
    Date;
}

export async function persistCompletedSale({
  tx,
  input,
  preparedDetails,
  preparedPayments,
  condicionPago,
  totals,
}: PersistSaleInput) {
  const sale =
    await saleWriteRepository
      .createSale(
        tx,
        {
          empresa_id:
            input.empresaId,

          sucursal_id:
            input.sucursalId,

          almacen_id:
            input.almacenId,

          cliente_id:
            input.clienteId ??
            null,

          usuario_id:
            input.usuarioId,

          sesion_caja_id:
            input.sesionCajaId ??
            null,

          folio:
            input.folio,

          condicion_pago:
            condicionPago,

          estado:
            "BORRADOR",

          subtotal:
            totals.subtotal,

          descuento:
            totals.descuento,

          impuesto:
            totals.impuesto,

          total:
            totals.total,

          observaciones:
            input.observaciones ??
            null,
        },
      );

  for (
    const item of
    preparedDetails
  ) {
    const detail =
      await saleWriteRepository
        .createDetail(
          tx,
          {
            venta_id:
              sale.id,

            producto_id:
              item.product.id,

            descripcion:
              item.descripcion,

            cantidad:
              item.cantidad,

            precio_unitario:
              item.precioUnitario,

            costo_unitario:
              item.costoUnitario,

            descuento_porcentaje:
              item
                .descuentoPorcentaje,

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

    if (
      !item.product
        .controla_inventario
    ) {
      continue;
    }

    const movement =
      await saleInventoryRepository
        .createInventoryMovement(
          tx,
          {
            productoId:
              item.product.id,

            almacenId:
              input.almacenId,

            usuarioId:
              input.usuarioId,

            tipo:
              "SALIDA",

            cantidad:
              item.cantidad,

            costoUnitario:
              item.costoUnitario,

            ventaId:
              sale.id,

            ventaDetalleId:
              detail.id,

            motivo:
              "Venta",
          },
        );

    await createSaleStockOutSync({
      tx,

      movimientoInventarioId:
        movement.id,

      saleId:
        sale.id,

      saleDetailId:
        detail.id,

      codigoBarras:
        item.product
          .codigo_barras,

      sku:
        item.product.sku,

      quantity:
        item.cantidad,
    });
  }

  const createdPayments:
    CreatedPaymentResult[] = [];

  for (
    const payment of
    preparedPayments
  ) {
    const createdPayment =
      await salePaymentRepository
        .createSalePayment(
          tx,
          {
            venta_id:
              sale.id,

            metodo_pago_id:
              payment
                .paymentMethod
                .id,

            sesion_caja_id:
              input.sesionCajaId ??
              null,

            monto:
              payment.monto,

            referencia:
              payment.referencia,
          },
        );

    if (
      payment.paymentMethod
        .es_efectivo
    ) {
      if (
        input.sesionCajaId ===
          undefined ||
        input.sesionCajaId ===
          null
      ) {
        throw new SaleContextError(
          "sesion_caja_id",
          "Una venta pagada en efectivo requiere una sesión de caja abierta.",
        );
      }

      await salePaymentRepository
        .createCashMovement(
          tx,
          {
            sesionCajaId:
              input.sesionCajaId,

            usuarioId:
              input.usuarioId,

            tipo:
              "ENTRADA",

            concepto:
              `Pago en efectivo de venta ${sale.folio}`,

            monto:
              payment.monto,

            referencia:
              `VENTA:${sale.id.toString()}:PAGO:${createdPayment.id.toString()}`,
          },
        );
    }

    createdPayments.push({
      id:
        createdPayment.id
          .toString(),

      metodo_pago_id:
        payment
          .paymentMethod
          .id
          .toString(),

      codigo:
        payment
          .paymentMethod
          .codigo,

      nombre:
        payment
          .paymentMethod
          .nombre,

      es_efectivo:
        payment
          .paymentMethod
          .es_efectivo,

      monto:
        decimalToNumber(
          createdPayment.monto,
        ),

      referencia:
        createdPayment.referencia,

      fecha:
        createdPayment.fecha,
    });
  }

  const completedSale =
    await saleWriteRepository
      .completeSale(
        tx,
        sale.id,
      );

  await saleAuditRepository.create(
    tx,
    {
      usuarioId:
        input.usuarioId,

      tabla:
        "venta",

      registroId:
        completedSale.id,

      accion:
        "INSERT",

      datosNuevos: {
        folio:
          completedSale.folio,

        estado:
          completedSale.estado,

        condicion_pago:
          completedSale
            .condicion_pago,

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
      completedSale.id
        .toString(),

    folio:
      completedSale.folio,

    condicion_pago:
      completedSale
        .condicion_pago,

    estado:
      completedSale.estado,

    subtotal:
      totals.subtotal,

    descuento:
      totals.descuento,

    impuesto:
      totals.impuesto,

    total:
      totals.total,

    pagos:
      createdPayments,
  };
}
