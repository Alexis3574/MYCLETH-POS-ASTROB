import type {
  Request,
  Response,
} from "express";

import {
  userRoleParamsSchema,
  userRoleUserParamsSchema,
} from "./user-role.schema.js";

import {
  userRoleService,
} from "./user-role.service.js";

function handleUserRoleError(
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
    case "USER_NOT_FOUND":
      return res.status(404).json({
        ok: false,
        message: "Usuario no encontrado.",
      });

    case "ROLE_NOT_FOUND":
      return res.status(404).json({
        ok: false,
        message: "Rol no encontrado.",
      });

    case "ROLE_INACTIVE":
      return res.status(409).json({
        ok: false,
        message:
          "No se puede asignar un rol inactivo.",
      });

    case "USER_ROLE_ALREADY_EXISTS":
      return res.status(409).json({
        ok: false,
        message:
          "El usuario ya tiene asignado este rol.",
      });

    case "USER_ROLE_NOT_FOUND":
      return res.status(404).json({
        ok: false,
        message:
          "El usuario no tiene asignado este rol.",
      });

    default:
      console.error(error);

      return res.status(500).json({
        ok: false,
        message:
          "Ocurrió un error procesando los roles del usuario.",
      });
  }
}

export const userRoleController = {
  async list(
    req: Request,
    res: Response,
  ) {
    const params =
      userRoleUserParamsSchema.safeParse(
        req.params,
      );

    if (!params.success) {
      return res.status(400).json({
        ok: false,
        message:
          "Identificador de usuario inválido.",
      });
    }

    try {
      const roles =
        await userRoleService.getByUser(
          BigInt(params.data.userId),
        );

      return res.json({
        ok: true,
        data: roles,
      });
    } catch (error) {
      return handleUserRoleError(
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
      userRoleParamsSchema.safeParse(
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
        await userRoleService.assign(
          BigInt(params.data.userId),
          BigInt(params.data.roleId),
        );

      return res.status(201).json({
        ok: true,
        message:
          "Rol asignado correctamente.",
        data: result,
      });
    } catch (error) {
      return handleUserRoleError(
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
      userRoleParamsSchema.safeParse(
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
        await userRoleService.remove(
          BigInt(params.data.userId),
          BigInt(params.data.roleId),
        );

      return res.json({
        ok: true,
        message:
          "Rol removido correctamente.",
        data: result,
      });
    } catch (error) {
      return handleUserRoleError(
        error,
        res,
      );
    }
  },
};