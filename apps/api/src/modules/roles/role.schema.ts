import { z } from "zod";

export const roleIdSchema = z.object({
  id: z
    .string()
    .regex(/^\d+$/, "El id del rol debe ser numérico"),
});

export const createRoleSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(1, "El código es obligatorio")
    .max(60, "El código no puede superar 60 caracteres"),

  nombre: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(100, "El nombre no puede superar 100 caracteres"),

  descripcion: z
    .string()
    .trim()
    .min(1, "La descripción no puede estar vacía")
    .nullable()
    .optional(),

  activo: z.boolean().optional(),
});

export const updateRoleSchema = z
  .object({
    codigo: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional(),

    nombre: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional(),

    descripcion: z
      .string()
      .trim()
      .min(1)
      .nullable()
      .optional(),

    activo: z.boolean().optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message:
        "Debe enviar al menos un campo para actualizar",
    },
  );