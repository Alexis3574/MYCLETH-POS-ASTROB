import {
  createSaleStockInSync,
} from "../../inventory-sync/inventory-sync.factory.js";

import {
  SaleCancellationConflictError,
  SaleCashSessionConflictError,
  SaleHasReturnsError,
  SaleNotFoundError,
} from "../errors/sale.errors.js";

import {
  saleAuditRepository,
} from "../repositories/sale-audit.repository.js";

import {
  saleContextRepository,
} from "../repositories/sale-context.repository.js";

import {
  saleInventoryRepository,
} from "../repositories/sale-inventory.repository.js";

import {
  salePaymentRepository,
} from "../repositories/sale-payment.repository.js";

import {
  saleWriteRepository,
} from "../repositories/sale.repository.js";

import type {
  CancelSaleInput,
} from "../types/sales.types.js";

import {
  decimalToNumber,
} from "../utils/sale-money.js";

import {
  saleHasReturns,
} from "./cancel/sale-cancel-return.validator.js";

export const saleCancelService = {
  async cancelSale(
    input: CancelSaleInput,
  ) {
    return saleWriteRepository.transaction(
      async (tx) => {
        /*
         * Se bloquea la venta para evitar que:
         *
         * - dos cancelaciones ocurran al mismo tiempo;
         * - una devolución y una cancelación se ejecuten
         *   concurrentemente sobre la misma venta.
         */
        const sale =
          await saleWriteRepository
            .lockSaleForCancellation(
              tx,
              input.saleId,
            );

        if (!sale) {
          throw new SaleNotFoundError();
        }

        /*
         * El usuario que ejecuta la cancelación
         * debe seguir siendo válido dentro de
         * la empresa de la venta.
         */
        const cancellingUser =
          await saleContextRepository
            .findUser(
              tx,
              sale.empresa_id,
              input.usuarioId,
            );

        if (!cancellingUser) {
          throw new SaleNotFoundError();
        }

        /*
         * Únicamente ventas COMPLETADAS
         * pueden ser canceladas.
         */
        if (
          sale.estado !==
          "COMPLETADA"
        ) {
          throw new SaleCancellationConflictError(
            sale.estado,
          );
        }

        /*
         * IMPORTANTE:
         *
         * Una venta con devoluciones ya no puede
         * cancelarse.
         *
         * De otro modo podríamos:
         *
         * 1. devolver inventario;
         * 2. reembolsar dinero;
         * 3. cancelar después la venta;
         * 4. devolver nuevamente inventario y dinero.
         *
         * El bloqueo FOR UPDATE de la venta hace
         * esta validación segura frente a concurrencia,
         * porque el proceso de devolución también
         * bloquea la misma venta.
         */
        const hasReturns =
          await saleHasReturns(
            tx,
            sale.id,
          );

        if (hasReturns) {
          throw new SaleHasReturnsError();
        }

        /*
         * Antes de modificar inventario validamos
         * todas las sesiones de caja que habrá
         * que utilizar para devolver efectivo.
         *
         * De esta forma no hacemos cambios parciales
         * antes de descubrir que la caja está cerrada.
         */
        for (
          const payment of
          sale.venta_pago
        ) {
          if (
            !payment
              .metodo_pago
              .es_efectivo
          ) {
            continue;
          }

          if (
            payment.sesion_caja_id ===
            null
          ) {
            throw new SaleCashSessionConflictError(
              0n,
            );
          }

          const cashSession =
            await saleContextRepository
              .findCashSession(
                tx,
                payment.sesion_caja_id,
              );

          if (
            !cashSession ||
            cashSession.estado !==
              "ABIERTA" ||
            cashSession.fecha_cierre !==
              null
          ) {
            throw new SaleCashSessionConflictError(
              payment.sesion_caja_id,
            );
          }
        }

        let restoredItems =
          0;

        /*
         * Se devuelve al inventario únicamente
         * lo que originalmente salió por esta venta.
         */
        for (
          const detail of
          sale.venta_detalle
        ) {
          const originalMovement =
            await saleInventoryRepository
              .findSaleStockOutMovement(
                tx,
                sale.id,
                detail.id,
                detail.producto_id,
                sale.almacen_id,
              );

          if (!originalMovement) {
            continue;
          }

          const quantity =
            decimalToNumber(
              originalMovement.cantidad,
            );

          if (
            !Number.isInteger(
              quantity,
            ) ||
            quantity <= 0
          ) {
            throw new Error(
              `No se puede revertir el movimiento del producto ${detail.producto.sku} porque su cantidad no es un entero positivo.`,
            );
          }

          const costoUnitario =
            originalMovement
              .costo_unitario ===
            null
              ? null
              : decimalToNumber(
                  originalMovement
                    .costo_unitario,
                );

          const movement =
            await saleInventoryRepository
              .createInventoryMovement(
                tx,
                {
                  productoId:
                    detail.producto_id,

                  almacenId:
                    sale.almacen_id,

                  usuarioId:
                    input.usuarioId,

                  tipo:
                    "ENTRADA",

                  cantidad:
                    quantity,

                  costoUnitario,

                  ventaId:
                    sale.id,

                  ventaDetalleId:
                    detail.id,

                  motivo:
                    "Cancelación de venta",
                },
              );

          /*
           * También se registra la sincronización
           * de regreso al Ecommerce.
           */
          await createSaleStockInSync({
            tx,

            movimientoInventarioId:
              movement.id,

            saleId:
              sale.id,

            saleDetailId:
              detail.id,

            codigoBarras:
              detail.producto
                .codigo_barras,

            sku:
              detail.producto
                .sku,

            quantity,
          });

          restoredItems +=
            quantity;
        }

        /*
         * Se revierte únicamente el efectivo físico.
         *
         * TARJETA, TRANSFERENCIA, CREDITO, etc.
         * no producen movimiento_caja.
         */
        for (
          const payment of
          sale.venta_pago
        ) {
          if (
            !payment
              .metodo_pago
              .es_efectivo
          ) {
            continue;
          }

          if (
            payment.sesion_caja_id ===
            null
          ) {
            throw new SaleCashSessionConflictError(
              0n,
            );
          }

          const paymentAmount =
            decimalToNumber(
              payment.monto,
            );

          await salePaymentRepository
            .createCashMovement(
              tx,
              {
                sesionCajaId:
                  payment.sesion_caja_id,

                usuarioId:
                  input.usuarioId,

                tipo:
                  "SALIDA",

                concepto:
                  `Cancelación de pago en efectivo de venta ${sale.folio}`,

                monto:
                  paymentAmount,

                referencia:
                  `CANCELACION:${sale.id.toString()}:PAGO:${payment.id.toString()}`,
              },
            );
        }

        const cancelledSale =
          await saleWriteRepository
            .cancelSale(
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
              cancelledSale.id,

            accion:
              "UPDATE",

            datosAnteriores: {
              estado:
                sale.estado,
            },

            datosNuevos: {
              estado:
                cancelledSale.estado,

              unidades_reintegradas:
                restoredItems,
            },

            ipOrigen:
              input.ipOrigen ??
              null,
          },
        );

        return {
          id:
            cancelledSale.id
              .toString(),

          folio:
            cancelledSale.folio,

          estado:
            cancelledSale.estado,

          unidades_reintegradas:
            restoredItems,
        };
      },
    );
  },
};
