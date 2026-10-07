import type {
  NextFunction,
  Request,
  Response,
} from "express";

import {
  listSalesQuerySchema,
} from "./sale.query.schema.js";

import {
  SaleQueryAccessError,
  SaleQueryNotFoundError,
  saleQueryService,
} from "./sale.query.service.js";

export const saleQueryController = {
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

      const parsedQuery =
        listSalesQuerySchema
          .safeParse(
            req.query,
          );

      if (
        !parsedQuery.success
      ) {
        res.status(400).json({
          ok: false,
          code:
            "INVALID_SALE_QUERY",

          message:
            "Los parámetros de consulta no son válidos.",

          errors:
            parsedQuery.error
              .flatten()
              .fieldErrors,
        });

        return;
      }

      const result =
        await saleQueryService
          .listSales(
            req.auth.userId,
            parsedQuery.data,
          );

      res.status(200).json({
        ok: true,
        data:
          result.sales,
        pagination:
          result.pagination,
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
        await saleQueryService
          .getSaleById(
            req.auth.userId,
            BigInt(
              idParam,
            ),
          );

      res.status(200).json({
        ok: true,
        data:
          result,
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