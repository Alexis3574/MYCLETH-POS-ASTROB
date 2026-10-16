import type {
  Request,
  Response,
} from "express";

import {
  createRoleSchema,
  roleIdSchema,
  updateRoleSchema,
} from "./role.schema.js";

import {
  roleService,
} from "./role.service.js";

function handleRoleError(
  error: unknown,
  res: Response,
) {
  if (
    error instanceof Error &&
    error.message === "ROLE_NOT_FOUND"
  ) {
    return res.status(404).json({
      ok: false,
      message: "Rol no encontrado.",
    });
  }

  if (
    error instanceof Error &&
    error.message ===
      "ROLE_CODE_ALREADY_EXISTS"
  ) {
    return res.status(409).json({
      ok: false,
      message:
        "Ya existe un rol con ese código.",
    });
  }

  if (
    error instanceof Error &&
    error.message === "ROLE_IN_USE"
  ) {
    return res.status(409).json({
      ok: false,
      message:
        "El rol no puede eliminarse porque tiene usuarios o permisos asignados.",
    });
  }

  console.error(error);

  return res.status(500).json({
    ok: false,
    message:
      "Ocurrió un error interno procesando el rol.",
  });
}

export const roleController = {
  async list(
    _req: Request,
    res: Response,
  ) {
    try {
      const roles =
        await roleService.getAll();

      return res.json({
        ok: true,
        data: roles,
      });
    } catch (error) {
      return handleRoleError(
        error,
        res,
      );
    }
  },

  async getById(
    req: Request,
    res: Response,
  ) {
    const params =
      roleIdSchema.safeParse(
        req.params,
      );

    if (!params.success) {
      return res.status(400).json({
        ok: false,
        message:
          "Identificador de rol inválido.",
        errors:
          params.error.flatten(),
      });
    }

    try {
      const role =
        await roleService.getById(
          BigInt(params.data.id),
        );

      return res.json({
        ok: true,
        data: role,
      });
    } catch (error) {
      return handleRoleError(
        error,
        res,
      );
    }
  },

  async create(
    req: Request,
    res: Response,
  ) {
    const body =
      createRoleSchema.safeParse(
        req.body,
      );

    if (!body.success) {
      return res.status(400).json({
        ok: false,
        message:
          "Datos de rol inválidos.",
        errors:
          body.error.flatten(),
      });
    }

    try {
      const role =
        await roleService.create(
          body.data,
        );

      return res.status(201).json({
        ok: true,
        message:
          "Rol creado correctamente.",
        data: role,
      });
    } catch (error) {
      return handleRoleError(
        error,
        res,
      );
    }
  },

  async update(
    req: Request,
    res: Response,
  ) {
    const params =
      roleIdSchema.safeParse(
        req.params,
      );

    if (!params.success) {
      return res.status(400).json({
        ok: false,
        message:
          "Identificador de rol inválido.",
        errors:
          params.error.flatten(),
      });
    }

    const body =
      updateRoleSchema.safeParse(
        req.body,
      );

    if (!body.success) {
      return res.status(400).json({
        ok: false,
        message:
          "Datos de actualización inválidos.",
        errors:
          body.error.flatten(),
      });
    }

    try {
      const role =
        await roleService.update(
          BigInt(params.data.id),
          body.data,
        );

      return res.json({
        ok: true,
        message:
          "Rol actualizado correctamente.",
        data: role,
      });
    } catch (error) {
      return handleRoleError(
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
      roleIdSchema.safeParse(
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
        await roleService.delete(
          BigInt(params.data.id),
        );

      return res.json({
        ok: true,
        message:
          "Rol eliminado correctamente.",
        data: result,
      });
    } catch (error) {
      return handleRoleError(
        error,
        res,
      );
    }
  },
};