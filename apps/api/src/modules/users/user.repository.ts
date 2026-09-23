import { prisma } from "../../lib/prisma.js";

const publicUserSelect = {
  id: true,
  empresa_id: true,
  username: true,
  nombre: true,
  apellido: true,
  email: true,
  telefono: true,
  activo: true,
  bloqueado: true,
  intentos_fallidos: true,
  ultimo_acceso: true,
  creado_en: true,
  actualizado_en: true,
} as const;

interface FindUsersParams {
  skip: number;
  take: number;
}

interface CreateUserData {
  empresa_id: bigint;
  username: string;
  password_hash: string;
  nombre: string;
  apellido?: string | null;
  email?: string | null;
  telefono?: string | null;
  activo?: boolean;
}

interface UpdateUserData {
  username?: string;
  nombre?: string;
  apellido?: string | null;
  email?: string | null;
  telefono?: string | null;
  activo?: boolean;
}

export const userRepository = {
  async count(): Promise<number> {
    return prisma.usuario.count();
  },

  async findMany({ skip, take }: FindUsersParams) {
    return prisma.usuario.findMany({
      skip,
      take,
      select: publicUserSelect,
      orderBy: {
        id: "asc",
      },
    });
  },

  async findById(id: bigint) {
    return prisma.usuario.findUnique({
      where: {
        id,
      },
      select: publicUserSelect,
    });
  },

  async findByUsername(
    empresaId: bigint,
    username: string
  ) {
    return prisma.usuario.findFirst({
      where: {
        empresa_id: empresaId,
        username,
      },
      select: {
        id: true,
        empresa_id: true,
        username: true,
      },
    });
  },

  async findByEmail(
    empresaId: bigint,
    email: string
  ) {
    return prisma.usuario.findFirst({
      where: {
        empresa_id: empresaId,
        email,
      },
      select: {
        id: true,
        empresa_id: true,
        email: true,
      },
    });
  },

  async companyExists(empresaId: bigint) {
    return prisma.empresa.findUnique({
      where: {
        id: empresaId,
      },
      select: {
        id: true,
      },
    });
  },

  async create(data: CreateUserData) {
    return prisma.usuario.create({
      data,
      select: publicUserSelect,
    });
  },

  async update(id: bigint, data: UpdateUserData) {
    return prisma.usuario.update({
      where: {
        id,
      },
      data,
      select: publicUserSelect,
    });
  },

  async updatePassword(
    id: bigint,
    passwordHash: string
  ) {
    return prisma.usuario.update({
      where: {
        id,
      },
      data: {
        password_hash: passwordHash,
      },
      select: {
        id: true,
      },
    });
  },
};