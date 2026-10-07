/**
 * POSMYCLETH — Paso 1: inspección de Inventario.
 * Guardar en apps/api/scripts/inventory/inspect-inventory.ts.
 * Ejecutar desde apps/api: npx tsx scripts/inventory/inspect-inventory.ts
 * Las consultas a PostgreSQL son únicamente SELECT.
 * Este archivo genera un informe; no ejecuta pruebas funcionales.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { prisma } from "../../src/lib/prisma.js";

type InspectionRow = Record<string, unknown>;
type InspectionSection =
  | { name: string; ok: true; data: InspectionRow[] }
  | { name: string; ok: false; error: string };

const apiRoot = process.cwd();

function serialize(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item,
    2,
  );
}

function safeMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : "Error de inspección.";
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) message = message.split(databaseUrl).join("[DATABASE_URL OCULTA]");
  return message.replace(/postgres(?:ql)?:\/\/[^\s\"']+/gi, "[CONEXIÓN OCULTA]");
}

function gitInfo(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: apiRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
  } catch {
    return null;
  }
}

async function inspect(
  name: string,
  query: () => Promise<InspectionRow[]>,
): Promise<InspectionSection> {
  try {
    const data = await query();
    console.log(`[OK] ${name}: ${data.length} fila(s).`);
    return { name, ok: true, data };
  } catch (error) {
    const message = safeMessage(error);
    console.error(`[ERROR] ${name}: ${message}`);
    return { name, ok: false, error: message };
  }
}

function listTypeScriptFiles(relativeDir: string): string[] {
  const absoluteDir = path.join(apiRoot, relativeDir);
  if (!existsSync(absoluteDir)) return [];
  return readdirSync(absoluteDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const relativeName = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) return listTypeScriptFiles(relativeName);
      return entry.isFile() && entry.name.endsWith(".ts") ? [relativeName] : [];
    });
}

function collectSourceFiles() {
  // Lista limitada al código necesario para integrar Inventario.
  // No se recopilan .env, logs, node_modules ni el cliente generado de Prisma.
  const fixedFiles = [
    "package.json",
    "tsconfig.json",
    "prisma/schema.prisma",
    "src/app.ts",
    "src/routes/index.ts",
    "src/types/express.d.ts",
    "src/middleware/permission.middleware.ts",
    "src/integrations/ecommerce/inventory-operation-id.ts",
  ];
  const sourceDirs = [
    "src/modules/sales",
    "src/modules/inventory-sync",
    "src/modules/products",
    "src/modules/inventory",
  ];
  const candidates = [...new Set([
    ...fixedFiles,
    ...sourceDirs.flatMap(listTypeScriptFiles),
  ])].sort();
  const files: { path: string; content: string }[] = [];
  const missing: string[] = [];

  for (const relativeName of candidates) {
    const absoluteName = path.join(apiRoot, relativeName);
    if (!existsSync(absoluteName)) {
      missing.push(relativeName);
      continue;
    }
    files.push({
      path: relativeName,
      content: readFileSync(absoluteName, "utf8"),
    });
  }
  for (const relativeDir of sourceDirs) {
    if (!existsSync(path.join(apiRoot, relativeDir))) missing.push(`${relativeDir}/`);
  }
  return { files, missing };
}

async function main(): Promise<void> {
  if (!existsSync(path.join(apiRoot, "prisma/schema.prisma"))) {
    throw new Error("Ejecuta este script desde la carpeta apps/api del repositorio.");
  }

  const sections: InspectionSection[] = [];

  sections.push(await inspect("Tablas relacionadas", () => prisma.$queryRaw<InspectionRow[]>`
    SELECT n.nspname AS esquema, c.relname AS tabla, c.relkind::text AS clase
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pos'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND (
        c.relname IN ('existencia', 'producto', 'almacen', 'sucursal', 'empresa',
                     'usuario', 'usuario_sucursal', 'unidad_medida', 'permiso', 'rol', 'rol_permiso')
        OR c.relname LIKE '%inventario%'
        OR c.relname LIKE '%ajuste%'
        OR c.relname LIKE 'venta%'
        OR c.relname LIKE 'devolucion%'
      )
    ORDER BY c.relname
  `));

  sections.push(await inspect("Columnas y expresiones generadas", () => prisma.$queryRaw<InspectionRow[]>`
    SELECT c.relname AS tabla, a.attnum AS orden, a.attname AS columna,
           format_type(a.atttypid, a.atttypmod) AS tipo,
           a.attnotnull AS no_nulo, a.attgenerated::text AS generado,
           pg_get_expr(d.adbin, d.adrelid) AS expresion
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = 'pos' AND c.relkind IN ('r', 'p')
      AND a.attnum > 0 AND NOT a.attisdropped
      AND (
        c.relname IN ('existencia', 'producto', 'almacen', 'sucursal', 'usuario_sucursal', 'unidad_medida')
        OR c.relname LIKE '%inventario%' OR c.relname LIKE '%ajuste%'
      )
    ORDER BY c.relname, a.attnum
  `));

  sections.push(await inspect("Restricciones CHECK, únicas y relaciones", () => prisma.$queryRaw<InspectionRow[]>`
    SELECT c.relname AS tabla, k.conname AS restriccion,
           k.contype::text AS tipo, k.convalidated AS validada,
           pg_get_constraintdef(k.oid, true) AS definicion
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pos'
      AND (
        c.relname IN ('existencia', 'producto', 'almacen', 'sucursal', 'unidad_medida')
        OR c.relname LIKE '%inventario%' OR c.relname LIKE '%ajuste%'
      )
    ORDER BY c.relname, k.conname
  `));

  sections.push(await inspect("Índices, incluidos índices únicos parciales", () => prisma.$queryRaw<InspectionRow[]>`
    SELECT tablename AS tabla, indexname AS indice, indexdef AS definicion
    FROM pg_indexes
    WHERE schemaname = 'pos'
      AND (tablename IN ('existencia', 'producto', 'almacen', 'sucursal')
           OR tablename LIKE '%inventario%' OR tablename LIKE '%ajuste%')
    ORDER BY tablename, indexname
  `));

  sections.push(await inspect("Triggers de inventario, ventas y devoluciones", () => prisma.$queryRaw<InspectionRow[]>`
    SELECT c.relname AS tabla, t.tgname AS trigger,
           t.tgenabled::text AS habilitado, fn.nspname AS esquema_funcion,
           p.proname AS funcion, pg_get_triggerdef(t.oid, true) AS definicion
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace fn ON fn.oid = p.pronamespace
    WHERE n.nspname = 'pos' AND NOT t.tgisinternal
      AND (c.relname = 'existencia' OR c.relname LIKE '%inventario%'
           OR c.relname LIKE '%ajuste%' OR c.relname LIKE 'venta%'
           OR c.relname LIKE 'devolucion%')
    ORDER BY c.relname, t.tgname
  `));

  sections.push(await inspect("Funciones aplicadas por esos triggers", () => prisma.$queryRaw<InspectionRow[]>`
    SELECT DISTINCT fn.nspname AS esquema, p.proname AS funcion,
           p.oid::text AS identificador, pg_get_functiondef(p.oid) AS definicion
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace fn ON fn.oid = p.pronamespace
    WHERE n.nspname = 'pos' AND NOT t.tgisinternal
      AND (c.relname = 'existencia' OR c.relname LIKE '%inventario%'
           OR c.relname LIKE '%ajuste%' OR c.relname LIKE 'venta%'
           OR c.relname LIKE 'devolucion%')
    ORDER BY esquema, funcion, identificador
  `));

  sections.push(await inspect("Permisos existentes de Inventario", () => prisma.$queryRaw<InspectionRow[]>`
    SELECT id::text AS id, codigo, modulo, descripcion
    FROM pos.permiso
    WHERE codigo LIKE 'INVENTARIO.%'
    ORDER BY id
  `));

  sections.push(await inspect("Asignación de permisos de Inventario a roles", () => prisma.$queryRaw<InspectionRow[]>`
    SELECT r.id::text AS rol_id, r.codigo AS rol, r.activo,
           p.id::text AS permiso_id, p.codigo AS permiso
    FROM pos.rol_permiso rp
    JOIN pos.rol r ON r.id = rp.rol_id
    JOIN pos.permiso p ON p.id = rp.permiso_id
    WHERE p.codigo LIKE 'INVENTARIO.%'
    ORDER BY r.codigo, p.codigo
  `));

  const productTests = [
    "tests/products-catalogo/product-values.test.mjs",
    "tests/products-catalogo/product-schema.test.ts",
  ];
  const metadata = {
    generado_en: new Date().toISOString(),
    rama: gitInfo(["branch", "--show-current"]),
    commit: gitInfo(["rev-parse", "HEAD"]),
    alcance: "Inspección de solo lectura y recopilación de fuentes; no valida funcionamiento.",
    pendiente_productos_catalogo: {
      estado: "Implementado e instalado; validación funcional pendiente. No cerrado.",
      typecheck: "Aprobado previamente en el equipo del usuario; no sustituye las pruebas.",
      verificar: [
        "Endpoints", "Permisos", "Aislamiento entre empresas", "Altas", "Edición",
        "Estados", "Duplicados", "Impuestos", "Compatibilidad con ventas",
        "Compatibilidad con sincronización del Ecommerce",
      ],
      pruebas: productTests.map((file) => ({
        archivo: `apps/api/${file}`,
        presente: existsSync(path.join(apiRoot, file)),
        ejecutada_por_esta_inspeccion: false,
      })),
      campos_fijos_tras_alta: ["sku", "codigo_barras", "unidad", "tipo", "controla_inventario"],
      sincronizacion: "El worker identifica productos por código de barras. Los cambios administrativos del catálogo no se sincronizan automáticamente.",
    },
    inventario: "Pendiente de implementación e integración; esta inspección no lo instala.",
  };

  const sources = collectSourceFiles();
  const reportDir = path.join(apiRoot, "docs/inventory/inspection");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(reportDir, `inventory-inspection-${timestamp}.txt`);
  const parts = [
    "POSMYCLETH — INSPECCIÓN PREVIA DE INVENTARIO",
    serialize({ metadata, sections, archivos_no_encontrados: sources.missing }),
    ...sources.files.map((file) => `\n========================================\nFILE: ${file.path}\n========================================\n${file.content}`),
  ];
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, parts.join("\n\n"), { encoding: "utf8", flag: "wx" });

  const failed = sections.filter((section) => !section.ok);
  console.log(`\nFuentes recopiladas: ${sources.files.length}.`);
  console.log(`Informe: ${path.relative(apiRoot, reportPath).split(path.sep).join("/")}`);
  console.log("Productos/Catálogo: validación funcional pendiente; no cerrado.");
  if (failed.length > 0) {
    process.exitCode = 1;
    console.error(`Inspección incompleta: ${failed.length} sección(es) con error. El informe contiene los detalles.`);
  } else {
    console.log("Inspección completada. Las pruebas funcionales siguen pendientes.");
  }
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  console.error(`[inventory-inspection] ${safeMessage(error)}`);
} finally {
  try {
    await prisma.$disconnect();
  } catch (error) {
    process.exitCode = 1;
    console.error(`[inventory-inspection] ${safeMessage(error)}`);
  }
}
