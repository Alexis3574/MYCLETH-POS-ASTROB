import { prisma } from "../../lib/prisma.js";

export const permissionRepository = {
  async findAll() {
    return prisma.permiso.findMany({
      orderBy: [
        {
          modulo: "asc",
        },
        {
          codigo: "asc",
        },
      ],
    });
  },
};