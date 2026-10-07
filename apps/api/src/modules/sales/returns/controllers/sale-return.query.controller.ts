import type {
  NextFunction,
  Request,
  Response,
} from "express";

import {
  SaleReturnQueryNotFoundError,
  SaleReturnQuerySaleNotFoundError,
} from "../errors/sale-return.errors.js";

import {
  saleReturnQueryService,
} from "../services/sale-return.query.service.js";

function parseId(
  value: unknown,
): bigint | null {
  const text =
    String(value);

  if (
    !/^\d+$/.test(text)
  ) {
    return null;
  }

  return BigInt(text);
}

export const saleReturnQueryController = {
  async list(
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
        parseId(
          req.params.id,
        );

      if (saleId === null) {
        res.status(400).json({
          ok: false,
          message:
            "El ID de la venta no es válido.",
        });

        return;
      }

      const result =
        await saleReturnQueryService
          .list(
            saleId,
            req.auth.empresaId,
          );

      res.status(200).json({
        ok: true,
        data: result,
      });
    } catch (error) {
      if (
        error instanceof
        SaleReturnQuerySaleNotFoundError
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

      next(error);
    }
  },

  async getById(
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
        parseId(
          req.params.id,
        );

      if (saleId === null) {
        res.status(400).json({
          ok: false,
          message:
            "El ID de la venta no es válido.",
        });

        return;
      }

      const returnId =
        parseId(
          req.params.returnId,
        );

      if (returnId === null) {
        res.status(400).json({
          ok: false,
          message:
            "El ID de la devolución no es válido.",
        });

        return;
      }

      const result =
        await saleReturnQueryService
          .getById(
            saleId,
            returnId,
            req.auth.empresaId,
          );

      res.status(200).json({
        ok: true,
        data: result,
      });
    } catch (error) {
      if (
        error instanceof
        SaleReturnQuerySaleNotFoundError ||
        error instanceof
        SaleReturnQueryNotFoundError
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

      next(error);
    }
  },
};