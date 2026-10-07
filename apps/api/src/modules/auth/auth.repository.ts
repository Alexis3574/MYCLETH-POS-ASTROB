import { prisma } from "../../lib/prisma.js";

const authUserInclude = {
  empresa: {
    select: {
      id: true,
      nombre_comercial: true,
      activo: true,
    },
  },

  usuario_rol: {
    where: {
      rol: {
        activo: true,
      },
    },

    include: {
      rol: {
        include: {
          rol_permiso: {
            include: {
              permiso: true,
            },
          },
        },
      },
    },
  },
} as const;

export const authRepository = {
  async findByUsername(
    empresaId: bigint,
    username: string,
  ) {
    return prisma.usuario.findUnique({
      where: {
        empresa_id_username: {
          empresa_id: empresaId,
          username,
        },
      },

      include: authUserInclude,
    });
  },

  async findById(userId: bigint) {
    return prisma.usuario.findUnique({
      where: {
        id: userId,
      },

      include: authUserInclude,
    });
  },

  async registerFailedAttempt(
    userId: bigint,
  ) {
    return prisma.usuario.update({
      where: {
        id: userId,
      },

      data: {
        intentos_fallidos: {
          increment: 1,
        },
      },

      select: {
        intentos_fallidos: true,
      },
    });
  },

  async blockUser(userId: bigint) {
    return prisma.usuario.update({
      where: {
        id: userId,
      },

      data: {
        bloqueado: true,
      },
    });
  },

  async registerSuccessfulLogin(
    userId: bigint,
  ) {
    return prisma.usuario.update({
      where: {
        id: userId,
      },

      data: {
        intentos_fallidos: 0,
        ultimo_acceso: new Date(),
      },
    });
  },
};