import type {
  NextFunction,
  Request,
  Response,
} from "express";

import { createSaleSchema } from "./sale.schema.js";
import { saleService } from "./sale.service.js";

export const saleController = {
  async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const validation =
        createSaleSchema.safeParse(req.body);

      if (!validation.success) {
        res.status(400).json({
          ok: false,
          message:
            "Los datos enviados no son válidos.",
          errors:
            validation.error.issues.map(
              (issue) => ({
                field:
                  issue.path.join("."),
                message:
                  issue.message,
              }),
            ),
        });

        return;
      }

      const input = validation.data;

      const result =
        await saleService.createSale({
          empresaId: BigInt(
            input.empresa_id,
          ),

          sucursalId: BigInt(
            input.sucursal_id,
          ),

          almacenId: BigInt(
            input.almacen_id,
          ),

          clienteId:
            input.cliente_id ===
              undefined ||
            input.cliente_id === null
              ? null
              : BigInt(
                  input.cliente_id,
                ),

          usuarioId: BigInt(
            input.usuario_id,
          ),

          sesionCajaId:
            input.sesion_caja_id ===
              undefined ||
            input.sesion_caja_id === null
              ? null
              : BigInt(
                  input.sesion_caja_id,
                ),

          folio: input.folio,

          subtotal: input.subtotal,
          descuento:
            input.descuento,
          impuesto:
            input.impuesto,
          total: input.total,

          observaciones:
            input.observaciones ??
            null,

          detalles:
            input.detalles.map(
              (detail) => ({
                productoId: BigInt(
                  detail.producto_id,
                ),

                descripcion:
                  detail.descripcion ??
                  null,

                cantidad:
                  detail.cantidad,

                precioUnitario:
                  detail.precio_unitario,

                costoUnitario:
                  detail.costo_unitario ??
                  null,

                descuentoPorcentaje:
                  detail.descuento_porcentaje,

                tasaImpuesto:
                  detail.tasa_impuesto,

                subtotalLinea:
                  detail.subtotal_linea,

                descuentoImporte:
                  detail.descuento_importe,

                impuestoImporte:
                  detail.impuesto_importe,

                totalLinea:
                  detail.total_linea,
              }),
            ),
        });

      res.status(201).json({
        ok: true,
        message:
          "Venta creada correctamente.",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
};