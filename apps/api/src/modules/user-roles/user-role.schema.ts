import { z } from "zod";

export const userRoleUserParamsSchema = z.object({
  userId: z
    .string()
    .regex(/^\d+$/, "El id del usuario debe ser numérico"),
});

export const userRoleParamsSchema = z.object({
  userId: z
    .string()
    .regex(/^\d+$/, "El id del usuario debe ser numérico"),

  roleId: z
    .string()
    .regex(/^\d+$/, "El id del rol debe ser numérico"),
});