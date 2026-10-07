import { z } from "zod";

export const rolePermissionRoleParamsSchema =
  z.object({
    roleId: z
      .string()
      .regex(
        /^\d+$/,
        "El id del rol debe ser numérico",
      ),
  });

export const rolePermissionParamsSchema =
  z.object({
    roleId: z
      .string()
      .regex(
        /^\d+$/,
        "El id del rol debe ser numérico",
      ),

    permissionId: z
      .string()
      .regex(
        /^\d+$/,
        "El id del permiso debe ser numérico",
      ),
  });