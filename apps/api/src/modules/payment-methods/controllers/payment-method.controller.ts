import type { Request, RequestHandler } from "express";
import { z } from "zod";
import { paymentMethodListSchema, paymentMethodIdSchema } from "../payment-method.schema.js";
import { paymentMethodService } from "../services/payment-method.service.js";

function handle(action: (req: Request) => Promise<unknown>): RequestHandler {
  return async (req, res) => {
    try {
      const result = await action(req);
      if (result === null) {
        res.status(404).json({ ok: false, code: "PAYMENT_METHOD_NOT_FOUND", message: "Método de pago no encontrado." });
        return;
      }
      res.status(200).json({ ok: true, data: result });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          ok: false,
          code: "PAYMENT_METHOD_VALIDATION",
          message: "Parámetros inválidos.",
          errors: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
        });
        return;
      }
      console.error("[payment-methods]", error);
      res.status(500).json({ ok: false, code: "PAYMENT_METHOD_INTERNAL", message: "Error interno consultando métodos de pago." });
    }
  };
}

export const paymentMethodController = {
  list: handle((req) => paymentMethodService.list(paymentMethodListSchema.parse(req.query))),
  get: handle((req) => paymentMethodService.get(paymentMethodIdSchema.parse(req.params.id))),
};
