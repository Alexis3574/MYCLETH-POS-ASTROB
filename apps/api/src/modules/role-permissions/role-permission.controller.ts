import type {
  Request,
  Response,
} from "express";

import {
  rolePermissionParamsSchema,
  rolePermissionRoleParamsSchema,
} from "./role-permission.schema.js";

import {
  rolePermissionService,
} from "./role-permission.service.js";

function handleRolePermissionError(
  error: unknown,
  res: Response,
) {
  if (!(error instanceof Error)) {
    return res.status(500).json({
      ok: false,
      message: "Error interno.",
    });
  }

  switch (error.message) {
    case "ROLE_NOT_FOUND":
      return res.status(404).json({
        ok: false,
        message:
          "Rol no encontrado.",
      });

    case "ROLE_INACTIVE":
      return res.status(409).json({
        ok: false,
        message:
          "No se pueden asignar permisos a un rol inactivo.",
      });

    case "PERMISSION_NOT_FOUND":
      return res.status(404).json({
        ok: false,
        message:
          "Permiso no encontrado.",
      });

    case "ROLE_PERMISSION_ALREADY_EXISTS":
      return res.status(409).json({
        ok: false,
        message:
          "El rol ya tiene asignado este permiso.",
      });

    case "ROLE_PERMISSION_NOT_FOUND":
      return res.status(404).json({
        ok: false,
        message:
          "El rol no tiene asignado este permiso.",
      });

    default:
      console.error(error);

      return res.status(500).json({
        ok: false,
        message:
          "Ocurrió un error procesando los permisos del rol.",
      });
  }
}

export const rolePermissionController = {
  async list(
    req: Request,
    res: Response,
  ) {
    const params =
      rolePermissionRoleParamsSchema.safeParse(
        req.params,
      );

    if (!params.success) {
      return res.status(400).json({
        ok: false,
        message:
          "Identificador de rol inválido.",
      });
    }

    try {
      const result =
        await rolePermissionService.getByRole(
          BigInt(params.data.roleId),
        );

      return res.json({
        ok: true,
        data: result,
      });
    } catch (error) {
      return handleRolePermissionError(
        error,
        res,
      );
    }
  },

  async assign(
    req: Request,
    res: Response,
  ) {
    const params =
      rolePermissionParamsSchema.safeParse(
        req.params,
      );

    if (!params.success) {
      return res.status(400).json({
        ok: false,
        message:
          "Identificadores inválidos.",
      });
    }

    try {
      const result =
        await rolePermissionService.assign(
          BigInt(params.data.roleId),
          BigInt(
            params.data.permissionId,
          ),
        );

      return res.status(201).json({
        ok: true,
        message:
          "Permiso asignado correctamente.",
        data: result,
      });
    } catch (error) {
      return handleRolePermissionError(
        error,
        res,
      );
    }
  },

  async remove(
    req: Request,
    res: Response,
  ) {
    const params =
      rolePermissionParamsSchema.safeParse(
        req.params,
      );

    if (!params.success) {
      return res.status(400).json({
        ok: false,
        message:
          "Identificadores inválidos.",
      });
    }

    try {
      const result =
        await rolePermissionService.remove(
          BigInt(params.data.roleId),
          BigInt(
            params.data.permissionId,
          ),
        );

      return res.json({
        ok: true,
        message:
          "Permiso removido correctamente.",
        data: result,
      });
    } catch (error) {
      return handleRolePermissionError(
        error,
        res,
      );
    }
  },
};