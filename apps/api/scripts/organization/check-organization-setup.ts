import "dotenv/config";
import { prisma } from "../../src/lib/prisma.js";

try {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid/invalid");
  if (url.pathname !== "/pos_novnix" || !["localhost", "127.0.0.1"].includes(url.hostname) ||
      (url.port && url.port !== "5432")) throw new Error("Solo se permite pos_novnix local.");
  const rows = await prisma.$queryRaw<{ database: string; port: number; tables: number; permissions: number }[]>`
    SELECT current_database() AS database, inet_server_port() AS port,
      (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='pos' AND table_name IN
        ('empresa','sucursal','almacen','usuario_sucursal')) AS tables,
      (SELECT count(*)::int FROM "pos"."permiso" WHERE codigo='CONFIGURACION.GESTIONAR') AS permissions
  `;
  const state = rows[0];
  if (state?.database !== "pos_novnix" || state.port !== 5432 || state.tables !== 4 || state.permissions !== 1) {
    throw new Error("Esquema o permisos insuficientes para Organización.");
  }
  console.log("[OK] Base de desarrollo, cuatro tablas y permiso CONFIGURACION.GESTIONAR confirmados.");
} catch (error) {
  console.error("[ERROR ORGANIZATION SETUP]", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
