import assert from "node:assert/strict";
import { prisma } from "../../src/lib/prisma.js";

try {
  const columns = await prisma.$queryRaw<Array<{ generado: string; expresion: string | null }>>`
    SELECT a.attgenerated::text AS generado, pg_get_expr(d.adbin, d.adrelid) AS expresion
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = 'pos' AND c.relname = 'existencia' AND a.attname = 'disponible'
  `;
  assert.equal(columns[0]?.generado, "s", "disponible debe ser una columna generada almacenada.");
  assert.match(columns[0]?.expresion ?? "", /cantidad\s*-\s*reservado/);
  const triggers = await prisma.$queryRaw<Array<{ trigger: string; habilitado: string; funcion: string }>>`
    SELECT t.tgname AS trigger, t.tgenabled::text AS habilitado, p.proname AS funcion
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'pos' AND c.relname = 'movimiento_inventario'
      AND t.tgname = 'trg_movimiento_inventario_aplicar' AND NOT t.tgisinternal
  `;
  assert.equal(triggers[0]?.funcion, "fn_aplicar_movimiento_inventario");
  assert.ok(["O", "A"].includes(triggers[0]?.habilitado ?? ""), "El trigger de inventario debe estar habilitado.");
  const table = await prisma.$queryRaw<Array<{ tabla: string | null }>>`SELECT to_regclass('pos.ajuste_inventario')::text AS tabla`;
  assert.ok(table[0]?.tabla, "Falta aplicar la migración de ajuste_inventario.");
  const permissions = await prisma.permiso.findMany({ where: { codigo: { in: ["INVENTARIO.VER", "INVENTARIO.AJUSTAR"] } }, select: { id: true, codigo: true } });
  assert.equal(permissions.length, 2, "Deben existir INVENTARIO.VER e INVENTARIO.AJUSTAR.");
  console.table(permissions.map((row) => ({ id: row.id.toString(), codigo: row.codigo })));
  const assignments = await prisma.rol_permiso.findMany({
    where: { permiso: { codigo: { in: ["INVENTARIO.VER", "INVENTARIO.AJUSTAR"] } } },
    select: { rol: { select: { codigo: true, activo: true } }, permiso: { select: { codigo: true } } },
  });
  console.table(assignments.map((row) => ({ rol: row.rol.codigo, activo: row.rol.activo, permiso: row.permiso.codigo })));
  console.log("[OK] Columna generada, trigger, tabla y permisos comprobados.");
  console.log("Productos/Catálogo: validación funcional pendiente; no cerrado.");
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
} finally { await prisma.$disconnect(); }
