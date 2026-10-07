import type {
  NextFunction,
  Request,
  Response,
} from "express";

import {
  authRepository,
} from "../modules/auth/auth.repository.js";

import {
  tokenService,
} from "../modules/auth/token.service.js";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authorization =
    req.headers.authorization;

  if (!authorization) {
    return res.status(401).json({
      ok: false,
      message:
        "Token de autenticación requerido.",
    });
  }

  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i,
    );

  if (!match) {
    return res.status(401).json({
      ok: false,
      message:
        "Formato de autorización inválido.",
    });
  }

  try {
    const token =
      match[1];

    const payload =
      await tokenService.verifyAccessToken(
        token,
      );

    const user =
      await authRepository.findById(
        payload.userId,
      );

    if (!user) {
      return res.status(401).json({
        ok: false,
        message:
          "Usuario de autenticación no encontrado.",
      });
    }

    if (
      user.empresa_id !==
      payload.empresaId
    ) {
      return res.status(401).json({
        ok: false,
        message:
          "Token de autenticación inválido.",
      });
    }

    if (
      !user.activo ||
      !user.empresa.activo
    ) {
      return res.status(403).json({
        ok: false,
        message:
          "La cuenta está inactiva.",
      });
    }

    if (user.bloqueado) {
      return res.status(403).json({
        ok: false,
        message:
          "La cuenta está bloqueada.",
      });
    }

    req.auth = {
      userId: user.id,
      empresaId:
        user.empresa_id,
      username:
        user.username,
    };

    return next();
  } catch {
    return res.status(401).json({
      ok: false,
      message:
        "Token inválido o expirado.",
    });
  }
}