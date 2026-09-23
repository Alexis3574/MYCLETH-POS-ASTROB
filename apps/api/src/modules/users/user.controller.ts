import type { NextFunction, Request, Response } from "express";
import { userService } from "./user.service.js";
import { changePasswordSchema, createUserSchema, updateUserSchema } from "./user.schema.js";

export const userController = {
  async count(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const total = await userService.countUsers();

      res.status(200).json({
        ok: true,
        data: {
          total,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async list(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const page =
        Number.parseInt(String(req.query.page ?? "1"), 10) || 1;

      const limit =
        Number.parseInt(String(req.query.limit ?? "20"), 10) || 20;

      const result = await userService.listUsers(page, limit);

      res.status(200).json({
        ok: true,
        data: result.users,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  },

  async getById(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const idParam = String(req.params.id);

    if (!/^\d+$/.test(idParam)) {
      res.status(400).json({
        ok: false,
        message: "El ID del usuario no es válido.",
      });

      return;
    }

    const id = BigInt(idParam);

    const user = await userService.getUserById(id);

    if (!user) {
      res.status(404).json({
        ok: false,
        message: "Usuario no encontrado.",
      });

      return;
    }

    res.status(200).json({
      ok: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
},

   async create(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const validation = createUserSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        ok: false,
        message: "Los datos enviados no son válidos.",
        errors: validation.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });

      return;
    }

    const result = await userService.createUser(validation.data);

    if (result.status === "COMPANY_NOT_FOUND") {
      res.status(404).json({
        ok: false,
        message: "La empresa indicada no existe.",
      });

      return;
    }

    if (result.status === "USERNAME_EXISTS") {
      res.status(409).json({
        ok: false,
        message: "El nombre de usuario ya está registrado en esta empresa.",
      });

      return;
    }

    if (result.status === "EMAIL_EXISTS") {
      res.status(409).json({
        ok: false,
        message: "El correo electrónico ya está registrado en esta empresa.",
      });

      return;
    }

    res.status(201).json({
      ok: true,
      message: "Usuario creado correctamente.",
      data: result.user,
    });
  } catch (error) {
    next(error);
  }
},

  async update(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const idParam = String(req.params.id);

    if (!/^\d+$/.test(idParam)) {
      res.status(400).json({
        ok: false,
        message: "El ID del usuario no es válido.",
      });

      return;
    }

    const validation = updateUserSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        ok: false,
        message: "Los datos enviados no son válidos.",
        errors: validation.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });

      return;
    }

    const id = BigInt(idParam);

    const result = await userService.updateUser(
      id,
      validation.data
    );

    if (result.status === "NOT_FOUND") {
      res.status(404).json({
        ok: false,
        message: "Usuario no encontrado.",
      });

      return;
    }

    if (result.status === "USERNAME_EXISTS") {
      res.status(409).json({
        ok: false,
        message:
          "El nombre de usuario ya está registrado en esta empresa.",
      });

      return;
    }

    if (result.status === "EMAIL_EXISTS") {
      res.status(409).json({
        ok: false,
        message:
          "El correo electrónico ya está registrado en esta empresa.",
      });

      return;
    }

    res.status(200).json({
      ok: true,
      message: "Usuario actualizado correctamente.",
      data: result.user,
    });
  } catch (error) {
    next(error);
  }
},
 
   async changePassword(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const idParam = String(req.params.id);

    if (!/^\d+$/.test(idParam)) {
      res.status(400).json({
        ok: false,
        message: "El ID del usuario no es válido.",
      });

      return;
    }

    const validation = changePasswordSchema.safeParse(
      req.body
    );

    if (!validation.success) {
      res.status(400).json({
        ok: false,
        message: "Los datos enviados no son válidos.",
        errors: validation.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });

      return;
    }

    const id = BigInt(idParam);

    const result = await userService.changePassword(
      id,
      validation.data
    );

    if (result.status === "NOT_FOUND") {
      res.status(404).json({
        ok: false,
        message: "Usuario no encontrado.",
      });

      return;
    }

    res.status(200).json({
      ok: true,
      message: "Contraseña actualizada correctamente.",
    });
  } catch (error) {
    next(error);
  }
},
};