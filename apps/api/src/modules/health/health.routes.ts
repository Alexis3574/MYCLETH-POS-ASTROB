import { Router } from "express";

import { prisma } from "../../lib/prisma.js";

const router = Router();

router.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,
    message: "API del POS funcionando correctamente",
  });
});

router.get("/db", async (_req, res, next) => {
  try {
    const totalUsuarios = await prisma.usuario.count();

    res.status(200).json({
      ok: true,
      message: "Conexión a PostgreSQL correcta",
      totalUsuarios,
    });
  } catch (error) {
    next(error);
  }
});

export default router;