import type {
  Request,
  Response,
} from "express";

import {
  permissionService,
} from "./permission.service.js";

export const permissionController = {
  async list(
    _req: Request,
    res: Response,
  ) {
    try {
      const permissions =
        await permissionService.getAll();

      return res.json({
        ok: true,
        data: permissions,
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        ok: false,
        message:
          "Ocurrió un error consultando los permisos.",
      });
    }
  },
};