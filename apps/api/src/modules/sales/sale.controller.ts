import type {
  NextFunction,
  Request,
  Response,
} from "express";

import {
  createSaleSchema,
} from "./sale.schema.js";

import {
  InsufficientStockError,
  SaleCancellationConflictError,
  SaleCashSessionConflictError,
  SaleContextError,
  SaleCreditRequiresClientError,
  SaleHasReturnsError,
  SaleNotFoundError,
  SalePaymentMethodError,
  SalePaymentTotalMismatchError,
  saleService,
} from "./sale.service.js";

function isSaleFolioDuplicateError(
  error: unknown,
): boolean {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return false;
  }

  const prismaError =
    error as {
      code?: unknown;
      message?: unknown;
      meta?: unknown;
    };

  if (
    prismaError.code !==
    "P2002"
  ) {
    return false;
  }

  const message =
    typeof prismaError.message ===
    "string"
      ? prismaError.message
      : "";

  let meta = "";

  try {
    meta =
      JSON.stringify(
        prismaError.meta ??
          {},
      );
  } catch {
    meta = "";
  }

  return (
    message.includes(
      "uq_venta_sucursal_folio",
    ) ||
    meta.includes(
      "uq_venta_sucursal_folio",
    ) ||
    (
      meta.includes(
        "sucursal_id",
      ) &&
      meta.includes(
        "folio",
      )
    )
  );
}

export const saleController = {
  async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.auth) {
        res.status(401).json({
          ok: false,

          message:
            "Autenticación requerida.",
        });

        return;
      }

      const validation =
        createSaleSchema.safeParse(
          req.body,
        );

      if (
        !validation.success
      ) {
        res.status(400).json({
          ok: false,

          message:
            "Los datos enviados no son válidos.",

          errors:
            validation.error.issues.map(
              (issue) => ({
                field:
                  issue.path.join(
                    ".",
                  ),

                message:
                  issue.message,
              }),
            ),
        });

        return;
      }

      const input =
        validation.data;

      const result =
        await saleService.createSale({
          empresaId:
            BigInt(
              input.empresa_id,
            ),

          sucursalId:
            BigInt(
              input.sucursal_id,
            ),

          almacenId:
            BigInt(
              input.almacen_id,
            ),

          clienteId:
            input.cliente_id ===
              undefined ||
            input.cliente_id ===
              null
              ? null
              : BigInt(
                  input.cliente_id,
                ),

          /*
           * La identidad del usuario viene
           * exclusivamente del JWT.
           */
          usuarioId:
            req.auth.userId,

          sesionCajaId:
            input.sesion_caja_id ===
              undefined ||
            input.sesion_caja_id ===
              null
              ? null
              : BigInt(
                  input.sesion_caja_id,
                ),

          folio:
            input.folio,

          observaciones:
            input.observaciones ??
            null,

          ipOrigen:
            req.ip ??
            null,

          detalles:
            input.detalles.map(
              (detail) => ({
                productoId:
                  BigInt(
                    detail.producto_id,
                  ),

                descripcion:
                  detail.descripcion ??
                  null,

                cantidad:
                  detail.cantidad,

                descuentoPorcentaje:
                  detail
                    .descuento_porcentaje,
              }),
            ),

          pagos:
            input.pagos.map(
              (payment) => ({
                metodoPagoId:
                  BigInt(
                    payment
                      .metodo_pago_id,
                  ),

                monto:
                  payment.monto,

                referencia:
                  payment.referencia ??
                  null,
              }),
            ),
        });

      res.status(201).json({
        ok: true,

        message:
          "Venta creada correctamente.",

        data:
          result,
      });
    } catch (error) {
      if (
        error instanceof
        SaleContextError
      ) {
        res.status(422).json({
          ok: false,

          code:
            error.code,

          message:
            error.message,

          data: {
            field:
              error.field,
          },
        });

        return;
      }

      if (
        error instanceof
        SaleCreditRequiresClientError
      ) {
        res.status(422).json({
          ok: false,

          code:
            error.code,

          message:
            error.message,

          data: {
            field:
              "cliente_id",
          },
        });

        return;
      }

      if (
        error instanceof
        SalePaymentMethodError
      ) {
        res.status(422).json({
          ok: false,

          code:
            error.code,

          message:
            error.message,

          data: {
            metodo_pago_id:
              error
                .paymentMethodId
                .toString(),
          },
        });

        return;
      }

      if (
        error instanceof
        SalePaymentTotalMismatchError
      ) {
        res.status(422).json({
          ok: false,

          code:
            error.code,

          message:
            error.message,

          data: {
            total_venta:
              error.saleTotal,

            total_pagos:
              error.paymentTotal,
          },
        });

        return;
      }

      if (
        error instanceof
        InsufficientStockError
      ) {
        res.status(409).json({
          ok: false,

          code:
            error.code,

          message:
            error.message,

          data: {
            producto_id:
              error.productoId
                .toString(),

            sku:
              error.sku,

            cantidad_solicitada:
              error.requested,

            cantidad_disponible:
              error.available,
          },
        });

        return;
      }

      if (
        isSaleFolioDuplicateError(
          error,
        )
      ) {
        res.status(409).json({
          ok: false,

          code:
            "SALE_FOLIO_ALREADY_EXISTS",

          message:
            "Ya existe una venta con ese folio en la sucursal.",
        });

        return;
      }

      next(error);
    }
  },

  async cancel(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const idParam =
        String(
          req.params.id,
        );

      if (
        !/^\d+$/.test(
          idParam,
        )
      ) {
        res.status(400).json({
          ok: false,

          message:
            "El ID de la venta no es válido.",
        });

        return;
      }

      if (!req.auth) {
        res.status(401).json({
          ok: false,

          message:
            "Autenticación requerida.",
        });

        return;
      }

      const result =
        await saleService.cancelSale({
          saleId:
            BigInt(
              idParam,
            ),

          usuarioId:
            req.auth.userId,

          ipOrigen:
            req.ip ??
            null,
        });

      res.status(200).json({
        ok: true,

        message:
          "Venta cancelada correctamente.",

        data:
          result,
      });
    } catch (error) {
      if (
        error instanceof
        SaleNotFoundError
      ) {
        res.status(404).json({
          ok: false,

          code:
            error.code,

          message:
            error.message,
        });

        return;
      }

      if (
        error instanceof
        SaleCancellationConflictError
      ) {
        res.status(409).json({
          ok: false,

          code:
            error.code,

          message:
            error.message,

          data: {
            estado_actual:
              error.currentStatus,
          },
        });

        return;
      }

      /*
       * Una venta que ya posee al menos
       * una devolución no puede después
       * cancelarse.
       */
      if (
        error instanceof
        SaleHasReturnsError
      ) {
        res.status(409).json({
          ok: false,

          code:
            error.code,

          message:
            error.message,
        });

        return;
      }

      if (
        error instanceof
        SaleCashSessionConflictError
      ) {
        res.status(409).json({
          ok: false,

          code:
            error.code,

          message:
            error.message,

          data: {
            sesion_caja_id:
              error.sesionCajaId
                .toString(),
          },
        });

        return;
      }

      next(error);
    }
  },
};
