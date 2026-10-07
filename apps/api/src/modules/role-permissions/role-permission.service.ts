import {
  rolePermissionRepository,
} from "./role-permission.repository.js";

export const rolePermissionService = {
  async getByRole(roleId: bigint) {
    const role =
      await rolePermissionRepository.findRole(
        roleId,
      );

    if (!role) {
      throw new Error(
        "ROLE_NOT_FOUND",
      );
    }

    const assignments =
      await rolePermissionRepository.findPermissionsByRole(
        roleId,
      );

    return {
      rol: {
        id: role.id.toString(),
        codigo: role.codigo,
        nombre: role.nombre,
        activo: role.activo,
      },

      permisos: assignments.map(
        (assignment) => ({
          id:
            assignment.permiso.id.toString(),

          codigo:
            assignment.permiso.codigo,

          modulo:
            assignment.permiso.modulo,

          descripcion:
            assignment.permiso.descripcion,
        }),
      ),
    };
  },

  async assign(
    roleId: bigint,
    permissionId: bigint,
  ) {
    const role =
      await rolePermissionRepository.findRole(
        roleId,
      );

    if (!role) {
      throw new Error(
        "ROLE_NOT_FOUND",
      );
    }

    if (!role.activo) {
      throw new Error(
        "ROLE_INACTIVE",
      );
    }

    const permission =
      await rolePermissionRepository.findPermission(
        permissionId,
      );

    if (!permission) {
      throw new Error(
        "PERMISSION_NOT_FOUND",
      );
    }

    const existing =
      await rolePermissionRepository.findAssignment(
        roleId,
        permissionId,
      );

    if (existing) {
      throw new Error(
        "ROLE_PERMISSION_ALREADY_EXISTS",
      );
    }

    const assignment =
      await rolePermissionRepository.assign(
        roleId,
        permissionId,
      );

    return {
      rol_id:
        assignment.rol_id.toString(),

      permiso: {
        id:
          assignment.permiso.id.toString(),

        codigo:
          assignment.permiso.codigo,

        modulo:
          assignment.permiso.modulo,

        descripcion:
          assignment.permiso.descripcion,
      },
    };
  },

  async remove(
    roleId: bigint,
    permissionId: bigint,
  ) {
    const role =
      await rolePermissionRepository.findRole(
        roleId,
      );

    if (!role) {
      throw new Error(
        "ROLE_NOT_FOUND",
      );
    }

    const permission =
      await rolePermissionRepository.findPermission(
        permissionId,
      );

    if (!permission) {
      throw new Error(
        "PERMISSION_NOT_FOUND",
      );
    }

    const existing =
      await rolePermissionRepository.findAssignment(
        roleId,
        permissionId,
      );

    if (!existing) {
      throw new Error(
        "ROLE_PERMISSION_NOT_FOUND",
      );
    }

    await rolePermissionRepository.remove(
      roleId,
      permissionId,
    );

    return {
      rol_id: roleId.toString(),
      permiso_id:
        permissionId.toString(),
    };
  },
};