import { permissionRepository } from "./permission.repository.js";

export const permissionService = {
  async getAll() {
    const permissions =
      await permissionRepository.findAll();

    return permissions.map(
      (permission) => ({
        id: permission.id.toString(),
        codigo: permission.codigo,
        modulo: permission.modulo,
        descripcion:
          permission.descripcion,
        creado_en:
          permission.creado_en,
      }),
    );
  },
};