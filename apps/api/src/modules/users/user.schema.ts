import { z } from "zod";

export const createUserSchema = z.object({
  empresa_id: z.coerce
    .string()
    .regex(/^\d+$/, "empresa_id debe ser un ID válido"),

  username: z
    .string()
    .trim()
    .min(3, "El username debe tener al menos 3 caracteres")
    .max(80, "El username no puede superar los 80 caracteres"),

  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .max(72, "La contraseña no puede superar los 72 caracteres"),

  nombre: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio")
    .max(100, "El nombre no puede superar los 100 caracteres"),

  apellido: z
    .string()
    .trim()
    .max(120, "El apellido no puede superar los 120 caracteres")
    .optional(),

  email: z
    .string()
    .trim()
    .email("El correo electrónico no es válido")
    .max(180, "El correo no puede superar los 180 caracteres")
    .optional(),

  telefono: z
    .string()
    .trim()
    .max(30, "El teléfono no puede superar los 30 caracteres")
    .optional(),

  activo: z.boolean().optional(),
});

export const updateUserSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "El username debe tener al menos 3 caracteres")
      .max(80, "El username no puede superar los 80 caracteres")
      .optional(),

    nombre: z
      .string()
      .trim()
      .min(1, "El nombre no puede estar vacío")
      .max(100, "El nombre no puede superar los 100 caracteres")
      .optional(),

    apellido: z
      .string()
      .trim()
      .max(120, "El apellido no puede superar los 120 caracteres")
      .nullable()
      .optional(),

    email: z
      .string()
      .trim()
      .email("El correo electrónico no es válido")
      .max(180, "El correo no puede superar los 180 caracteres")
      .nullable()
      .optional(),

    telefono: z
      .string()
      .trim()
      .max(30, "El teléfono no puede superar los 30 caracteres")
      .nullable()
      .optional(),

    activo: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message: "Debes enviar al menos un campo para actualizar.",
    }
  );

export const changePasswordSchema = z.object({
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .refine(
      (password) => Buffer.byteLength(password, "utf8") <= 72,
      "La contraseña es demasiado larga"
    ),
});

export type ChangePasswordInput = z.infer<
  typeof changePasswordSchema
>;

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;