import { prisma } from "../../lib/prisma.js";

export const rolePermissionRepository = {
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

  async findPermission(
    permissionId: bigint,
  ) {
    return prisma.permiso.findUnique({
      where: {
        id: permissionId,
      },

      select: {
        id: true,
        codigo: true,
        modulo: true,
        descripcion: true,
      },
    });
  },

  async findAssignment(
    roleId: bigint,
    permissionId: bigint,
  ) {
    return prisma.rol_permiso.findFirst({
      where: {
        rol_id: roleId,
        permiso_id: permissionId,
      },
    });
  },

  async findPermissionsByRole(
    roleId: bigint,
  ) {
    return prisma.rol_permiso.findMany({
      where: {
        rol_id: roleId,
      },

      include: {
        permiso: true,
      },

      orderBy: {
        permiso_id: "asc",
      },
    });
  },

  async assign(
    roleId: bigint,
    permissionId: bigint,
  ) {
    return prisma.rol_permiso.create({
      data: {
        rol_id: roleId,
        permiso_id: permissionId,
      },

      include: {
        permiso: true,
      },
    });
  },

  async remove(
    roleId: bigint,
    permissionId: bigint,
  ) {
    return prisma.rol_permiso.deleteMany({
      where: {
        rol_id: roleId,
        permiso_id: permissionId,
      },
    });
  },
};