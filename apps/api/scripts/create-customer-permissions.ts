import { prisma } from "../src/lib/prisma.js";

const permissions = [
  ["CLIENTES.VER", "Consultar clientes y direcciones"],
  ["CLIENTES.CREAR", "Registrar clientes"],
  ["CLIENTES.EDITAR", "Actualizar, activar/desactivar clientes y administrar direcciones"],
] as const;

try {
  for (const [codigo, descripcion] of permissions) {
    await prisma.permiso.upsert({
      where: { codigo },
      update: { modulo: "CLIENTES", descripcion },
      create: { codigo, modulo: "CLIENTES", descripcion },
    });
  }
  console.log("Permisos CLIENTES registrados. Asignar a roles autorizados por separado.");
} finally {
  await prisma.$disconnect();
}
