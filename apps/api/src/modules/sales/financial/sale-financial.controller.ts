import type {
  NextFunction,
  Request,
  Response,
} from "express";

import {
  SaleQueryAccessError,
  SaleQueryNotFoundError,
} from "../sale.query.service.js";

import {
  saleFinancialService,
} from "./sale-financial.service.js";

export const saleFinancialController = {
  async getSummary(
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

      const result =
        await saleFinancialService
          .getSummary(
            req.auth.userId,
            BigInt(
              idParam,
            ),
          );

      res.status(200).json({
        ok: true,
        data: result,
      });
    } catch (error) {
      if (
        error instanceof
        SaleQueryAccessError
      ) {
        res.status(403).json({
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
        SaleQueryNotFoundError
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
