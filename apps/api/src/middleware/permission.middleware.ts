import type {
  NextFunction,
  Request,
  Response,
} from "express";

import { prisma } from "../lib/prisma.js";

export function requirePermission(
  permissionCode: string,
) {
  return async function permissionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    if (!req.auth) {
      return res.status(401).json({
        ok: false,
        message:
          "Autenticación requerida.",
      });
    }

    try {
      const assignment =
        await prisma.usuario_rol.findFirst({
          where: {
            usuario_id:
              req.auth.userId,

            rol: {
              activo: true,

              rol_permiso: {
                some: {
                  permiso: {
                    codigo:
                      permissionCode,
                  },
                },
              },
            },
          },

          select: {
            usuario_id: true,
          },
        });

      if (!assignment) {
        return res.status(403).json({
          ok: false,
          message:
            "No tiene permisos para realizar esta operación.",
          permiso_requerido:
            permissionCode,
        });
      }

      return next();
    } catch (error) {
      console.error(
        "[permission]",
        error,
      );

      return res.status(500).json({
        ok: false,
        message:
          "Error verificando permisos.",
      });
    }
  };
}