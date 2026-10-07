import { roleRepository } from "./role.repository.js";

interface CreateRoleInput {
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  activo?: boolean;
}

interface UpdateRoleInput {
  codigo?: string;
  nombre?: string;
  descripcion?: string | null;
  activo?: boolean;
}

function serializeRole(role: {
  id: bigint;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  creado_en: Date;
  _count?: {
    usuario_rol: number;
    rol_permiso: number;
  };
}) {
  return {
    id: role.id.toString(),
    codigo: role.codigo,
    nombre: role.nombre,
    descripcion: role.descripcion,
    activo: role.activo,
    creado_en: role.creado_en,

    usuarios_asignados:
      role._count?.usuario_rol,

    permisos_asignados:
      role._count?.rol_permiso,
  };
}

export const roleService = {
  async getAll() {
    const roles =
      await roleRepository.findAll();

    return roles.map(serializeRole);
  },

  async getById(id: bigint) {
    const role =
      await roleRepository.findById(id);

    if (!role) {
      throw new Error(
        "ROLE_NOT_FOUND",
      );
    }

    return serializeRole(role);
  },

  async create(input: CreateRoleInput) {
    const existing =
      await roleRepository.findByCode(
        input.codigo,
      );

    if (existing) {
      throw new Error(
        "ROLE_CODE_ALREADY_EXISTS",
      );
    }

    const role =
      await roleRepository.create(input);

    return serializeRole(role);
  },

  async update(
    id: bigint,
    input: UpdateRoleInput,
  ) {
    const current =
      await roleRepository.findById(id);

    if (!current) {
      throw new Error(
        "ROLE_NOT_FOUND",
      );
    }

    if (
      input.codigo &&
      input.codigo !== current.codigo
    ) {
      const existing =
        await roleRepository.findByCode(
          input.codigo,
        );

      if (
        existing &&
        existing.id !== id
      ) {
        throw new Error(
          "ROLE_CODE_ALREADY_EXISTS",
        );
      }
    }

    const role =
      await roleRepository.update(
        id,
        input,
      );

    return serializeRole(role);
  },

  async delete(id: bigint) {
    const role =
      await roleRepository.findById(id);

    if (!role) {
      throw new Error(
        "ROLE_NOT_FOUND",
      );
    }

    const [
      users,
      permissions,
    ] = await Promise.all([
      roleRepository.countUsers(id),
      roleRepository.countPermissions(id),
    ]);

    if (
      users > 0 ||
      permissions > 0
    ) {
      throw new Error(
        "ROLE_IN_USE",
      );
    }

    await roleRepository.delete(id);

    return {
      id: id.toString(),
    };
  },
};