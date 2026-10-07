import type {
  Request,
  Response,
} from "express";

import {
  loginSchema,
} from "./auth.schema.js";

import {
  authService,
} from "./auth.service.js";

function handleAuthError(
  error: unknown,
  res: Response,
) {
  if (!(error instanceof Error)) {
    return res.status(500).json({
      ok: false,
      message:
        "Error interno.",
    });
  }

  switch (error.message) {
    case "INVALID_CREDENTIALS":
      return res.status(401).json({
        ok: false,
        message:
          "Usuario o contraseña incorrectos.",
      });

    case "ACCOUNT_INACTIVE":
      return res.status(403).json({
        ok: false,
        message:
          "La cuenta está inactiva.",
      });

    case "ACCOUNT_BLOCKED":
      return res.status(403).json({
        ok: false,
        message:
          "La cuenta está bloqueada.",
      });

    case "USER_NOT_FOUND":
      return res.status(404).json({
        ok: false,
        message:
          "Usuario no encontrado.",
      });

    default:
      console.error(error);

      return res.status(500).json({
        ok: false,
        message:
          "Ocurrió un error durante la autenticación.",
      });
  }
}

export const authController = {
  async login(
    req: Request,
    res: Response,
  ) {
    const validation =
      loginSchema.safeParse(
        req.body,
      );

    if (!validation.success) {
      return res.status(400).json({
        ok: false,
        message:
          "Datos de inicio de sesión inválidos.",

        errors:
          validation.error.flatten(),
      });
    }

    try {
      const result =
        await authService.login({
          empresaId:
            BigInt(
              validation.data
                .empresa_id,
            ),

          username:
            validation.data.username,

          password:
            validation.data.password,
        });

      return res.json({
        ok: true,
        message:
          "Inicio de sesión correcto.",
        data: result,
      });
    } catch (error) {
      return handleAuthError(
        error,
        res,
      );
    }
  },

  async me(
    req: Request,
    res: Response,
  ) {
    if (!req.auth) {
      return res.status(401).json({
        ok: false,
        message:
          "Autenticación requerida.",
      });
    }

    try {
      const user =
        await authService.getMe(
          req.auth.userId,
        );

      return res.json({
        ok: true,
        data: user,
      });
    } catch (error) {
      return handleAuthError(
        error,
        res,
      );
    }
  },
};