import { prisma } from "../../lib/prisma.js";

export const userRoleRepository = {
  async findUser(userId: bigint) {
    return prisma.usuario.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
      },
    });
  },

  async findRole(roleId: bigint) {
    return prisma.rol.findUnique({
      where: {
        id: roleId,
      },
      select: {
        id: true,
        codigo: true,
        nombre: true,
        activo: true,
      },
    });
  },

  async findAssignment(
    userId: bigint,
    roleId: bigint,
  ) {
    return prisma.usuario_rol.findFirst({
      where: {
        usuario_id: userId,
        rol_id: roleId,
      },
    });
  },

  async findRolesByUser(userId: bigint) {
    return prisma.usuario_rol.findMany({
      where: {
        usuario_id: userId,
      },

      orderBy: {
        rol_id: "asc",
      },

      include: {
        rol: {
          include: {
            _count: {
              select: {
                rol_permiso: true,
              },
            },
          },
        },
      },
    });
  },

  async assign(
    userId: bigint,
    roleId: bigint,
  ) {
    return prisma.usuario_rol.create({
      data: {
        usuario_id: userId,
        rol_id: roleId,
      },
      include: {
        rol: true,
      },
    });
  },

  async remove(
    userId: bigint,
    roleId: bigint,
  ) {
    return prisma.usuario_rol.deleteMany({
      where: {
        usuario_id: userId,
        rol_id: roleId,
      },
    });
  },
};