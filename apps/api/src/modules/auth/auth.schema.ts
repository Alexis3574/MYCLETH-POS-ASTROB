import { z } from "zod";

export const loginSchema = z.object({
  empresa_id: z
    .string()
    .regex(
      /^\d+$/,
      "El id de empresa debe ser numérico",
    ),

  username: z
    .string()
    .trim()
    .min(
      1,
      "El usuario es obligatorio",
    )
    .max(
      80,
      "El usuario no puede superar 80 caracteres",
    ),

  password: z
    .string()
    .min(
      1,
      "La contraseña es obligatoria",
    )
    .refine(
      (password) =>
        Buffer.byteLength(
          password,
          "utf8",
        ) <= 72,
      "La contraseña es demasiado larga",
    ),
});

export type LoginInput =
  z.infer<typeof loginSchema>;