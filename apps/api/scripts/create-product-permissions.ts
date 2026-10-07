import "dotenv/config";
import { prisma } from "../../src/lib/prisma.js";

// Este script se instala dentro de apps/api/scripts/products-catalogo.
const permissions = [
  { codigo: "PRODUCTOS.VER", modulo: "PRODUCTOS", descripcion: "Consultar productos, categorías, unidades e impuestos" },
  { codigo: "PRODUCTOS.CREAR", modulo: "PRODUCTOS", descripcion: "Registrar productos" },
  { codigo: "PRODUCTOS.EDITAR", modulo: "PRODUCTOS", descripcion: "Editar información del producto" },
  { codigo: "PRODUCTOS.CAMBIAR_ESTADO", modulo: "PRODUCTOS", descripcion: "Activar y desactivar productos" },
];

try {
  const rows = await prisma.$transaction(async (tx) => {
    const result = [];
    for (const permission of permissions) {
      const row = await tx.permiso.upsert({
        where: { codigo: permission.codigo }, update: {}, create: permission,
        select: { id: true, codigo: true },
      });
      result.push({ id: row.id.toString(), codigo: row.codigo });
    }
    return result;
  });
  console.log(JSON.stringify({ ok: true, data: rows }, null, 2));
} catch (error) {
  console.error('No se pudieron crear los permisos:', error instanceof Error ? error.message : 'Error desconocido');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
