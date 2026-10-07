import { userRoleRepository } from "./user-role.repository.js";

export const userRoleService = {
  async getByUser(userId: bigint) {
    const user =
      await userRoleRepository.findUser(userId);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const assignments =
      await userRoleRepository.findRolesByUser(
        userId,
      );

    return assignments.map(
      (assignment) => ({
        id: assignment.rol.id.toString(),
        codigo: assignment.rol.codigo,
        nombre: assignment.rol.nombre,
        descripcion:
          assignment.rol.descripcion,
        activo: assignment.rol.activo,

        permisos_asignados:
          assignment.rol._count
            .rol_permiso,
      }),
    );
  },

  async assign(
    userId: bigint,
    roleId: bigint,
  ) {
    const user =
      await userRoleRepository.findUser(userId);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const role =
      await userRoleRepository.findRole(roleId);

    if (!role) {
      throw new Error("ROLE_NOT_FOUND");
    }

    if (!role.activo) {
      throw new Error("ROLE_INACTIVE");
    }

    const existing =
      await userRoleRepository.findAssignment(
        userId,
        roleId,
      );

    if (existing) {
      throw new Error(
        "USER_ROLE_ALREADY_EXISTS",
      );
    }

    const assignment =
      await userRoleRepository.assign(
        userId,
        roleId,
      );

    return {
      usuario_id:
        assignment.usuario_id.toString(),

      rol: {
        id: assignment.rol.id.toString(),
        codigo: assignment.rol.codigo,
        nombre: assignment.rol.nombre,
        activo: assignment.rol.activo,
      },
    };
  },

  async remove(
    userId: bigint,
    roleId: bigint,
  ) {
    const user =
      await userRoleRepository.findUser(userId);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const role =
      await userRoleRepository.findRole(roleId);

    if (!role) {
      throw new Error("ROLE_NOT_FOUND");
    }

    const existing =
      await userRoleRepository.findAssignment(
        userId,
        roleId,
      );

    if (!existing) {
      throw new Error(
        "USER_ROLE_NOT_FOUND",
      );
    }

    await userRoleRepository.remove(
      userId,
      roleId,
    );

    return {
      usuario_id: userId.toString(),
      rol_id: roleId.toString(),
    };
  },
};