import type { NextFunction, Request, Response } from "express";

export function errorMiddleware(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error("ERROR:", error);

  const message =
    error instanceof Error ? error.message : "Error interno del servidor";

  res.status(500).json({
    ok: false,
    message,
  });
}