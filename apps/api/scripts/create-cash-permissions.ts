import { prisma } from "../src/lib/prisma.js";

const permissions = [
  ["CAJAS.VER", "Consultar cajas, sesiones y movimientos"],
  ["CAJAS.CREAR", "Registrar cajas"],
  ["CAJAS.EDITAR", "Actualizar y activar/desactivar cajas"],
  ["CAJAS.ABRIR", "Abrir sesiones de caja"],
  ["CAJAS.MOVER", "Registrar movimientos manuales"],
  ["CAJAS.CERRAR", "Cerrar y conciliar sesiones"],
] as const;

try {
  for (const [codigo, descripcion] of permissions) {
    await prisma.permiso.upsert({
      where: { codigo },
      update: { modulo: "CAJAS", descripcion },
      create: { codigo, modulo: "CAJAS", descripcion },
    });
  }
  console.log("Permisos CAJAS registrados; asignar a roles según política del POS.");
} finally {
  await prisma.$disconnect();
}
