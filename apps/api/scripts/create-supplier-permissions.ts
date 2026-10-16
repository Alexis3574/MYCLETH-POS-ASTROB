import { prisma } from "../src/lib/prisma.js";

const permissions = [
  ["PROVEEDORES.VER", "Consultar proveedores y direcciones"],
  ["PROVEEDORES.CREAR", "Crear proveedores"],
  ["PROVEEDORES.EDITAR", "Editar, activar/desactivar proveedores y gestionar direcciones"],
] as const;

try {
  for (const [codigo, descripcion] of permissions) {
    await prisma.permiso.upsert({
      where: { codigo },
      update: { modulo: "PROVEEDORES", descripcion },
      create: { codigo, modulo: "PROVEEDORES", descripcion },
    });
  }
  console.log("Permisos PROVEEDORES registrados. Asignarlos a roles autorizados por separado.");
} finally {
  await prisma.$disconnect();
}
