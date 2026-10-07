import type {
  NextFunction,
  Request,
  Response,
} from "express";

import {
  createSaleReturnSchema,
} from "../sale-return.schema.js";

import {
  SaleReturnContextError,
  SaleReturnDetailError,
  SaleReturnDuplicateDetailError,
  SaleReturnDuplicatePaymentError,
  SaleReturnNotAllowedError,
  SaleReturnNotFoundError,
  SaleReturnPaymentError,
  SaleReturnPaymentExceededError,
  SaleReturnPaymentTotalMismatchError,
  SaleReturnQuantityExceededError,
} from "../errors/sale-return.errors.js";

import {
  saleReturnService,
} from "../services/sale-return.service.js";

function isReturnFolioDuplicateError(
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

  let metadata = "";

  try {
    metadata =
      JSON.stringify(
        prismaError.meta ??
          {},
      );
  } catch {
    metadata = "";
  }

  const message =
    typeof prismaError.message ===
    "string"
      ? prismaError.message
      : "";

  return (
    message.includes(
      "folio",
    ) ||
    metadata.includes(
      "folio",
    )
  );
}

export const saleReturnController = {
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

      const saleId =
        String(
          req.params.id,
        );

      if (
        !/^\d+$/.test(
          saleId,
        )
      ) {
        res.status(400).json({
          ok: false,
          message:
            "El ID de la venta no es válido.",
        });

        return;
      }

      const validation =
        createSaleReturnSchema.safeParse(
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
        await saleReturnService
          .createReturn({
            saleId:
              BigInt(
                saleId,
              ),

            empresaId:
              req.auth.empresaId,

            usuarioId:
              req.auth.userId,

            folio:
              input.folio,

            motivo:
              input.motivo,

            sesionCajaId:
              input.sesion_caja_id ===
                undefined ||
              input.sesion_caja_id ===
                null
                ? null
                : BigInt(
                    input
                      .sesion_caja_id,
                  ),

            detalles:
              input.detalles.map(
                (detail) => ({
                  saleDetailId:
                    BigInt(
                      detail
                        .venta_detalle_id,
                    ),

                  cantidad:
                    detail.cantidad,
                }),
              ),

            ipOrigen:
              req.ip ??
              null,

            reembolsos:
              input.reembolsos.map(
                (refund) => ({
                  salePaymentId:
                    BigInt(
                      refund
                        .venta_pago_id,
                    ),

                  monto:
                    refund.monto,

                  referencia:
                    refund.referencia ??
                    null,
                }),
              ),
          });

      res.status(201).json({
        ok: true,

        message:
          "Devolución registrada correctamente.",

        data:
          result,
      });
    } catch (error) {
      if (
        error instanceof
        SaleReturnNotFoundError
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
        SaleReturnNotAllowedError
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

      if (
        error instanceof
        SaleReturnContextError
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
        SaleReturnDetailError ||
        error instanceof
        SaleReturnDuplicateDetailError
      ) {
        res.status(422).json({
          ok: false,
          code:
            error.code,
          message:
            error.message,

          data: {
            venta_detalle_id:
              error.saleDetailId
                .toString(),
          },
        });

        return;
      }

      if (
        error instanceof
        SaleReturnQuantityExceededError
      ) {
        res.status(409).json({
          ok: false,
          code:
            error.code,
          message:
            error.message,

          data: {
            venta_detalle_id:
              error.saleDetailId
                .toString(),

            cantidad_vendida:
              error.sold,

            cantidad_devuelta:
              error.alreadyReturned,

            cantidad_solicitada:
              error.requested,

            cantidad_disponible:
              error.available,
          },
        });

        return;
      }

      if (
        error instanceof
        SaleReturnPaymentError ||
        error instanceof
        SaleReturnDuplicatePaymentError
      ) {
        res.status(422).json({
          ok: false,
          code:
            error.code,
          message:
            error.message,

          data: {
            venta_pago_id:
              error.salePaymentId
                .toString(),
          },
        });

        return;
      }

      if (
        error instanceof
        SaleReturnPaymentExceededError
      ) {
        res.status(409).json({
          ok: false,
          code:
            error.code,
          message:
            error.message,

          data: {
            venta_pago_id:
              error.salePaymentId
                .toString(),

            monto_original:
              error.originalAmount,

            monto_reembolsado:
              error.alreadyRefunded,

            monto_solicitado:
              error.requested,

            monto_disponible:
              error.available,
          },
        });

        return;
      }

      if (
        error instanceof
        SaleReturnPaymentTotalMismatchError
      ) {
        res.status(422).json({
          ok: false,
          code:
            error.code,
          message:
            error.message,

          data: {
            total_devolucion:
              error.returnTotal,

            total_reembolsos:
              error.refundTotal,
          },
        });

        return;
      }

      if (
        isReturnFolioDuplicateError(
          error,
        )
      ) {
        res.status(409).json({
          ok: false,

          code:
            "SALE_RETURN_FOLIO_ALREADY_EXISTS",

          message:
            "Ya existe una devolución con ese folio.",
        });

        return;
      }

      next(error);
    }
  },
};
