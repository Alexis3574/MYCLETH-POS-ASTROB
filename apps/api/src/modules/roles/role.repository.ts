import { prisma } from "../../lib/prisma.js";

export const roleRepository = {
  async findAll() {
    return prisma.rol.findMany({
      orderBy: {
        id: "asc",
      },
      include: {
        _count: {
          select: {
            usuario_rol: true,
            rol_permiso: true,
          },
        },
      },
    });
  },

  async findById(id: bigint) {
    return prisma.rol.findUnique({
      where: {
        id,
      },
      include: {
        _count: {
          select: {
            usuario_rol: true,
            rol_permiso: true,
          },
        },
      },
    });
  },

  async findByCode(codigo: string) {
    return prisma.rol.findUnique({
      where: {
        codigo,
      },
    });
  },

  async create(data: {
    codigo: string;
    nombre: string;
    descripcion?: string | null;
    activo?: boolean;
  }) {
    return prisma.rol.create({
      data: {
        codigo: data.codigo,
        nombre: data.nombre,
        descripcion:
          data.descripcion ?? null,
        activo:
          data.activo ?? true,
      },
    });
  },

  async update(
    id: bigint,
    data: {
      codigo?: string;
      nombre?: string;
      descripcion?: string | null;
      activo?: boolean;
    },
  ) {
    return prisma.rol.update({
      where: {
        id,
      },
      data,
    });
  },

  async countUsers(id: bigint) {
    return prisma.usuario_rol.count({
      where: {
        rol_id: id,
      },
    });
  },

  async countPermissions(id: bigint) {
    return prisma.rol_permiso.count({
      where: {
        rol_id: id,
      },
    });
  },

  async delete(id: bigint) {
    return prisma.rol.delete({
      where: {
        id,
      },
    });
  },
};