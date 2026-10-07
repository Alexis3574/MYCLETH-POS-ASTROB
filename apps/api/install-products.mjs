import { existsSync, readFileSync, writeFileSync, copyFileSync, cpSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const api = path.resolve(process.argv[2] ?? process.cwd());
const appPath = path.join(api, 'src/app.ts');
const destination = path.join(api, 'src/modules/products');
const scriptsDestination = path.join(api, 'scripts/products-catalogo');
const sqlDestination = path.join(api, 'sql/products-catalogo');
const testsDestination = path.join(api, 'tests/products-catalogo');

for (const relative of ['package.json', 'src/app.ts', 'src/lib/prisma.ts', 'src/middleware/auth.middleware.ts', 'src/middleware/permission.middleware.ts']) {
  if (!existsSync(path.join(api, relative))) throw new Error(`No se encontró ${relative}. Ejecute desde apps/api o indique su ruta como argumento.`);
}
for (const target of [destination, scriptsDestination, sqlDestination, testsDestination]) {
  if (existsSync(target)) throw new Error(`La ruta ya existe: ${target}. Revise el módulo existente antes de instalar.`);
}

const current = readFileSync(appPath, 'utf8');
if (/\bproductRouter\b|["']\/api\/v1\/(products|categories|units|taxes)["']/.test(current)) {
  throw new Error('app.ts ya contiene rutas o referencias de catálogo. Revíselo antes de instalar.');
}
const anchor = /app\.use\(\s*errorMiddleware\s*\)\s*;/g;
if ([...current.matchAll(anchor)].length !== 1) throw new Error('No se encontró exactamente un app.use(errorMiddleware);. Integre las rutas según README.md.');
const imports = 'import { productRouter, categoryRouter, unitRouter, taxRouter } from "./modules/products/product.routes.js";\n';
const mounts = [
  'app.use("/api/v1/products", productRouter);',
  'app.use("/api/v1/categories", categoryRouter);',
  'app.use("/api/v1/units", unitRouter);',
  'app.use("/api/v1/taxes", taxRouter);',
].join('\n');
const apiAnchor = /app\.use\(\s*["']\/api\/v1["']\s*,\s*apiRoutes\s*\)\s*;/g;
const apiMatches = [...current.matchAll(apiAnchor)];
if (apiMatches.length > 1) throw new Error('Hay más de un montaje de apiRoutes. Integre las rutas manualmente.');
const updated = imports + (apiMatches.length === 1
  ? current.replace(apiAnchor, (match) => `${mounts}\n\n${match}`)
  : current.replace(anchor, `${mounts}\n\napp.use(errorMiddleware);`));
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDirectory = path.join(api, 'products-backups', timestamp);
mkdirSync(backupDirectory, { recursive: true });
copyFileSync(appPath, path.join(backupDirectory, 'app.ts'));
const pendingApp = path.join(api, 'src/app.products-pending');

try {
  cpSync(path.join(source, 'src/modules/products'), destination, { recursive: true, errorOnExist: true, force: false });
  cpSync(path.join(source, 'scripts'), scriptsDestination, { recursive: true, errorOnExist: true, force: false });
  cpSync(path.join(source, 'sql'), sqlDestination, { recursive: true, errorOnExist: true, force: false });
  cpSync(path.join(source, 'tests/products-catalogo'), testsDestination, { recursive: true, errorOnExist: true, force: false });
  writeFileSync(pendingApp, updated);
  renameSync(pendingApp, appPath);
} catch (error) {
  for (const target of [destination, scriptsDestination, sqlDestination, testsDestination, pendingApp]) rmSync(target, { recursive: true, force: true });
  copyFileSync(path.join(backupDirectory, 'app.ts'), appPath);
  throw error;
}

console.log('Módulo instalado en:', destination);
console.log('Respaldo de app.ts:', path.join(backupDirectory, 'app.ts'));
console.log('Siguiente: npm run typecheck, crear permisos y asignarlos al rol confirmado.');
