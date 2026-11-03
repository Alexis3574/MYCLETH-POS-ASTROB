/**
 * POSMYCLETH: orchestrator for the user's pos_novnix test database.
 * Never runs migrations, cleanup-all, Git commands, network Ecommerce or backups.
 * Snapshot checks are a detection mechanism, not a substitute for recovery.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = resolve(HERE, '../..');
const mode = process.argv[2] ?? '--audit';
if (mode === '--help') {
  console.log('Uso: node.exe scripts/validation/run-integral.mjs --audit | --full');
  console.log('--audit: unidades, HTTP readonly, integridad y carga acotada.');
  console.log('--full: agrega fixtures transaccionales y pruebas sintéticas con limpieza.');
  process.exit(0);
}
assert.ok(['--audit', '--full'].includes(mode) && process.argv.length <= 3, 'Modo no permitido');
const writeMode = mode === '--full';
// v2: all readonly child processes use a PostgreSQL-enforced readonly session.
const readonlyUrl = new URL(process.env.DATABASE_URL ?? 'postgres://invalid/invalid');
readonlyUrl.searchParams.set('options', [
  readonlyUrl.searchParams.get('options'),
  '-c default_transaction_read_only=on'
].filter(Boolean).join(' '));
assert.notEqual(process.env.NODE_ENV, 'production', 'Producción prohibida');
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL ausente en apps/api/.env');
const target = new URL(process.env.DATABASE_URL);
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'Solo PostgreSQL');
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'Solo PostgreSQL local');
assert.ok(!target.port || target.port === '5432', 'Solo PostgreSQL puerto 5432');
assert.equal(decodeURIComponent(target.pathname), '/pos_novnix', 'Únicamente pos_novnix');
assert.ok(!target.searchParams.has('host'), 'Host alternativo prohibido');
assert.ok(!target.searchParams.has('schema') || target.searchParams.get('schema') === 'pos', 'Solo esquema pos');
if (writeMode) {
  assert.equal(process.env.POS_INTEGRAL_ALLOW_WRITES, 'SI', 'Requiere POS_INTEGRAL_ALLOW_WRITES=SI');
  assert.equal(process.env.POS_INTEGRAL_WORKERS_STOPPED, 'SI', 'Confirma workers y servidores POS detenidos');
  assert.equal(process.env.INVENTORY_SYNC_ENABLED, 'false', 'INVENTORY_SYNC_ENABLED=false obligatorio');
}
assert.ok(existsSync(join(API, 'src/app.ts')), 'Ejecutar desde la copia real del repositorio');
const branch = execFileSync('git', ['branch', '--show-current'], {cwd: API, encoding: 'utf8'}).trim();
assert.equal(branch, 'devalex', 'Rama distinta de devalex');
const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: API, encoding: 'utf8'}).trim();
const expectedBaseline = 'f9fca83';
if (!head.startsWith(expectedBaseline)) console.warn('AVISO: HEAD diferente al snapshot analizado; pruebas pueden requerir actualización.');
const name = `integral-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`;
const folder = join(API, 'docs', 'validation-integral', 'results', name);
await mkdir(folder, {recursive: true});
const cases = [];
const logs = [];
const warnings = [];
let stopWrites = false;
let fatal = false;
let exitCode = 0;
const started = new Date().toISOString();
const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: 'test',
  POS_ALLOW_TEST_DB: 'SI',
  INVENTORY_SYNC_ENABLED: 'false',
  PURCHASES_TEST_DATABASE_URL: process.env.DATABASE_URL,
  PURCHASES_ALLOW_DB_TESTS: 'true',
  TRANSFERS_TEST_DATABASE_URL: process.env.DATABASE_URL,
  TRANSFERS_ALLOW_DB_TESTS: 'true',
  INVENTORY_CONCURRENCY_DATABASE_URL: process.env.DATABASE_URL,
  M11_TEST_DATABASE_URL: process.env.DATABASE_URL,
};
// Every known test DB alias is also enforced readonly; some tests connect using aliases.
const readonlyDatabaseEnv = Object.fromEntries([
  'DATABASE_URL', 'PURCHASES_TEST_DATABASE_URL',
  'TRANSFERS_TEST_DATABASE_URL', 'INVENTORY_CONCURRENCY_DATABASE_URL',
  'M11_TEST_DATABASE_URL'
].map(name => [name, readonlyUrl.toString()]));
function safe(s) {
  return String(s).split(process.env.DATABASE_URL).join('[DATABASE_URL]')
    .replace(/postgres(?:ql)?:\/\/[^\s\"']+/gi, '[DATABASE_URL]')
    .replace(/Bearer\s+[^\s"']+/g, 'Bearer [REDACTED]')
    .replace(/(access_token|refresh_token|password|password_hash)\s*[:=]\s*["']?[^\s,"']+/gi, '$1: [REDACTED]');
}
function record(title, group, status, details = '', elapsedMs = 0, log = null) {
  cases.push({name: title, group, status, details, elapsed_ms: elapsedMs, log});
  console.log(`[${status}] ${group} :: ${title}${details ? ` — ${safe(details).slice(0,250)}` : ''}`);
  if (status === 'FAIL') { exitCode = 1; fatal = true; }
}
function suite(title, group, files, args = [], opts = {}) {
  return {title, group, files, args, ...opts};
}
const UNIT = [
  'tests/product-schema.test.ts',
  'tests/products-catalogo/product-schema.test.ts',
  'tests/products-catalogo/product-values.test.mjs',
  'tests/inventory/inventory-schema.test.ts',
  'tests/inventory/inventory-validator.test.ts',
  'tests/inventory/inventory-values.test.ts',
  'tests/transfers/transfer-schema.test.ts',
  'tests/transfers/transfer-validator.test.ts',
  'tests/transfers/transfer-values.test.ts',
  'tests/authorization/branch-access.test.ts',
  'tests/ecommerce-sync/ecommerce-sync.unit.test.ts',
  'tests/ecommerce-sync/ecommerce-sync-retry.unit.test.ts',
  'tests/ecommerce-sync/ecommerce-sync-exhausted.unit.test.ts',
  'src/modules/sales/tests/sales.test.ts',
  'tests/purchases/purchase-unit.test.ts',
  'tests/cash/cash-unit.test.ts',
  'tests/sales-orders/order-unit.test.ts',
  'tests/sales-orders/order-conversion.unit.test.ts',
  'tests/customer-orders/customer-order-unit.test.ts',
  'tests/customer-orders/customer-order-conversion.unit.test.ts',
  'tests/customers/customer-unit.test.ts',
  'tests/suppliers/supplier-unit.test.ts',
  'tests/quotes/quote-unit.test.ts',
  'tests/organization/organization-unit.test.ts',
  'tests/payment-methods/payment-method-unit.test.ts',
  'src/modules/company-settings/company-settings.test.ts',
  'src/modules/dashboard/dashboard.test.ts',
  'src/modules/reports/reports.test.ts',
  'src/modules/audit-logs/tests/audit.test.ts',
  'src/modules/audit-logs/tests/m14-revocation.test.ts',
];
const READONLY = [
  suite('Catálogo de pagos SQL', 'readonly', ['tests/payment-methods/payment-method-postgres.readonly.mjs']),
  suite('Auditoría HTTP', 'readonly', ['src/modules/audit-logs/tests/m14-http-readonly.integration.mjs'], ['--test']),
  suite('Auditoría sucursales', 'readonly', ['src/modules/audit-logs/tests/m14-branch-readonly.integration.mjs'], ['--test']),
  suite('Auditoría seguridad sintética sin escrituras', 'readonly', ['src/modules/audit-logs/tests/m14-security-synthetic.integration.mjs'], ['--test']),
  // The original M15 HTTP test performs PUT and permanently writes to configuracion_empresa/auditoria.
  // Never run it under READONLY. Use a GET-only test and an enforced readonly connection.
  suite('Configuración empresa HTTP (GET estricto)', 'readonly', ['tests/integral/company-settings-http.readonly.mjs'], ['--test']),
  suite('Dashboard HTTP', 'readonly', ['src/modules/dashboard/dashboard.http.integration.mjs'], ['--test']),
  suite('Dashboard roles', 'readonly', ['src/modules/dashboard/dashboard.access.integration.mjs'], ['--test']),
  suite('Reportes HTTP CSV', 'readonly', ['src/modules/reports/reports.http.integration.mjs'], ['--test']),
  suite('Reportes seguridad', 'readonly', ['src/modules/reports/reports.security.integration.mjs'], ['--test']),
];
// Suites --run below are from the supplied archive. They create uniquely marked data
// and implement their OWN cleanup. Never treat cleanup as guaranteed after a crash.
const PREFLIGHTS = [
  suite('Inventario HTTP: preflight', 'preflight', ['tests/inventory/inventory-http-isolated-pos-novnix.integration.mjs'], ['--preflight']),
  suite('Pedidos venta: preflight', 'preflight', ['tests/sales-orders/m11-http-pos-novnix.integration.mjs'], ['--preflight']),
  suite('Pedidos clientes: preflight', 'preflight', ['tests/customer-orders/m12-http-pos-novnix.integration.mjs'], ['--preflight']),
  suite('Pedidos->Venta: preflight', 'preflight', ['tests/customer-orders/m12-fase2-http-pos-novnix.integration.mjs'], ['--preflight']),
  suite('Ecommerce HTTP: preflight', 'preflight', ['tests/ecommerce-sync/m13-http-pos-novnix.integration.mjs'], ['--preflight']),
  suite('Ecommerce concurrencia: preflight', 'preflight', ['tests/ecommerce-sync/m13-concurrency-pos-novnix.integration.mjs'], ['--preflight']),
  suite('Ecommerce reintento admin: preflight', 'preflight', ['tests/ecommerce-sync/m13-http-admin-retry-pos-novnix.integration.mjs'], ['--preflight']),
  suite('Ecommerce reintento manual: preflight', 'preflight', ['tests/ecommerce-sync/m13-manual-retry-pos-novnix.integration.mjs'], ['--preflight']),
];
const ROLLBACK = [
  suite('Productos CRUD y validaciones transaccionales', 'rollback', ['tests/products-catalogo/product-postgres.rollback.ts']),
  suite('Inventario ajustes +/- kardex rollback', 'rollback', ['tests/inventory/inventory-postgres.rollback.ts']),
  suite('Transferencias/cancelación rollback', 'rollback', ['tests/transfers/transfer-postgres.rollback.ts'], ['--test']),
  suite('Caja rollback', 'rollback', ['tests/cash/cash-postgres.rollback.mjs']),
  suite('Organización rollback', 'rollback', ['tests/organization/organization-postgres.rollback.mjs']),
];
const SYNTHETIC = [
  suite('Inventario HTTP ajustes e idempotencia', 'synthetic', ['tests/inventory/inventory-http-isolated-pos-novnix.integration.mjs'], ['--run']),
  suite('Inventario concurrencia', 'synthetic', ['tests/inventory/inventory-concurrency.ts']),
  suite('Compras recepción, salida y outbox', 'synthetic', ['tests/purchases/purchase-postgres.integration.ts']),
  suite('Transferencias concurrencia y stock', 'synthetic', ['tests/transfers/transfer-concurrency.ts'], ['--test']),
  suite('Pedidos de venta HTTP', 'synthetic', ['tests/sales-orders/m11-http-pos-novnix.integration.mjs'], ['--run']),
  suite('Pedidos clientes HTTP', 'synthetic', ['tests/customer-orders/m12-http-pos-novnix.integration.mjs'], ['--run']),
  suite('Pedidos clientes -> venta e inventario', 'synthetic', ['tests/customer-orders/m12-fase2-http-pos-novnix.integration.mjs'], ['--run']),
  suite('Ecommerce HTTP y RBAC', 'synthetic', ['tests/ecommerce-sync/m13-http-pos-novnix.integration.mjs'], ['--run']),
  suite('Ecommerce concurrencia outbox', 'synthetic', ['tests/ecommerce-sync/m13-concurrency-pos-novnix.integration.mjs'], ['--run']),
  suite('Ecommerce reintentos admin', 'synthetic', ['tests/ecommerce-sync/m13-http-admin-retry-pos-novnix.integration.mjs'], ['--run']),
  suite('Ecommerce reintentos manuales', 'synthetic', ['tests/ecommerce-sync/m13-manual-retry-pos-novnix.integration.mjs'], ['--run']),
];
async function runProcess(title, group, args, options = {}) {
  const slug = `${String(cases.length + 1).padStart(2,'0')}-${title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').slice(0,65)}`;
  const logName = `${slug}.log`;
  const logPath = join(folder, logName);
  const logfile = createWriteStream(logPath, {flags: 'wx'});
  const begin = performance.now();
  let tail = '';
  const timeout = options.timeout ?? 180000;
  let timedout = false;
  const result = await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, args, {cwd: API, env: {...env, ...(options.env ?? {})}, windowsHide: true, stdio: ['ignore','pipe','pipe']});
    const onData = chunk => {
      const clean = safe(chunk.toString());
      logfile.write(clean);
      tail = (tail + clean).slice(-10000);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { timedout = true; child.kill(); }, timeout);
    child.on('error', error => {clearTimeout(timer); resolvePromise({ok: false, reason: error.message});});
    child.on('close', (code, signal) => {clearTimeout(timer); resolvePromise({ok: code === 0 && !timedout, reason: `exit=${code},signal=${signal}${timedout?',TIMEOUT':''}`});});
  });
  await new Promise(r => logfile.end(r));
  const elapsed = Math.round(performance.now() - begin);
  record(title, group, result.ok ? 'PASS' : 'FAIL', result.ok ? `${elapsed} ms` : `${result.reason}; ver ${logName}`, elapsed, logName);
  if (!result.ok) console.error(safe(tail).split('\n').slice(-22).join('\n'));
  return result.ok;
}
async function runSuite(s, readonly = false) {
  for (const f of s.files) if (!existsSync(join(API, f))) {record(s.title,s.group,'SKIP',`Archivo inexistente: ${f}`);return null;}
  const nodeArgs = s.args.includes('--test')
    ? ['--import','tsx','--test',...s.files]
    : ['--import','tsx',...s.files,...s.args];
  return runProcess(s.title, s.group, nodeArgs, {
    timeout: s.timeout ?? 240000,
    env: readonly ? readonlyDatabaseEnv : undefined
  });
}
const client = new pg.Client({connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 30000});
let connected = false;
// Exact list, never accept table names from a user input or network response.
const SNAPSHOT_TABLES = [
  'almacen','auditoria','caja','categoria','cliente','cliente_direccion',
  'compra','compra_detalle','compra_pago','configuracion_empresa',
  'cotizacion','cotizacion_detalle','empresa','existencia','impuesto',
  'metodo_pago','movimiento_caja','movimiento_inventario',
  'sincronizacion_ecommerce_inventario','orden_venta','orden_venta_detalle',
  'pedido_cliente','pedido_cliente_detalle','permiso','producto',
  'producto_impuesto','proveedor','proveedor_direccion','rol','rol_permiso',
  'sesion_caja','sucursal','transferencia_almacen','transferencia_detalle',
  'unidad_medida','usuario','operacion_transferencia','usuario_rol','usuario_sucursal',
  'venta','venta_detalle','venta_pago','devolucion_pago','devolucion_venta',
  'devolucion_venta_detalle','ajuste_inventario','operacion_compra'
];
async function snapshot() {
  const state = {};
  await client.query('BEGIN');
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  try {
    for (const table of SNAPSHOT_TABLES) {
      const result = await client.query(`SELECT count(*)::int AS n, md5(COALESCE(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text), '')) AS fingerprint FROM pos.${table} AS t`);
      state[table] = result.rows[0];
    }
  } finally {await client.query('ROLLBACK');}
  return state;
}
async function integrity() {
  const checks = [
    ['ventas/sucursal/empresa', `SELECT count(*)::int AS n FROM pos.venta v JOIN pos.sucursal s ON s.id=v.sucursal_id WHERE v.empresa_id<>s.empresa_id`],
    ['ventas/almacen/sucursal', `SELECT count(*)::int AS n FROM pos.venta v JOIN pos.almacen a ON a.id=v.almacen_id WHERE v.sucursal_id<>a.sucursal_id`],
    ['ventas/cliente/empresa', `SELECT count(*)::int AS n FROM pos.venta v JOIN pos.cliente c ON c.id=v.cliente_id WHERE v.empresa_id<>c.empresa_id`],
    ['devolucion/usuario/empresa', `SELECT count(*)::int AS n FROM pos.devolucion_venta d JOIN pos.venta v ON v.id=d.venta_id JOIN pos.usuario u ON u.id=d.usuario_id WHERE u.empresa_id<>v.empresa_id`],
    ['compra/sucursal/empresa', `SELECT count(*)::int AS n FROM pos.compra c JOIN pos.sucursal s ON s.id=c.sucursal_id WHERE c.empresa_id<>s.empresa_id`],
    ['compra/proveedor/empresa', `SELECT count(*)::int AS n FROM pos.compra c JOIN pos.proveedor p ON p.id=c.proveedor_id WHERE c.empresa_id<>p.empresa_id`],
    ['movimientos/producto/almacen/empresa', `SELECT count(*)::int AS n FROM pos.movimiento_inventario m JOIN pos.producto p ON p.id=m.producto_id JOIN pos.almacen a ON a.id=m.almacen_id JOIN pos.sucursal s ON s.id=a.sucursal_id WHERE p.empresa_id<>s.empresa_id`],
    ['existencia/producto/almacen/empresa', `SELECT count(*)::int AS n FROM pos.existencia e JOIN pos.producto p ON p.id=e.producto_id JOIN pos.almacen a ON a.id=e.almacen_id JOIN pos.sucursal s ON s.id=a.sucursal_id WHERE p.empresa_id<>s.empresa_id`],
    ['existencia/disponible', `SELECT count(*)::int AS n FROM pos.existencia e WHERE e.disponible IS DISTINCT FROM (e.cantidad - e.reservado)`],
    ['usuarios/sucursal/empresa', `SELECT count(*)::int AS n FROM pos.usuario_sucursal us JOIN pos.usuario u ON u.id=us.usuario_id JOIN pos.sucursal s ON s.id=us.sucursal_id WHERE u.empresa_id<>s.empresa_id`],
    ['transferencias/origen/destino/empresa', `SELECT count(*)::int AS n FROM pos.transferencia_almacen t JOIN pos.almacen o ON o.id=t.almacen_origen_id JOIN pos.sucursal so ON so.id=o.sucursal_id JOIN pos.almacen d ON d.id=t.almacen_destino_id JOIN pos.sucursal sd ON sd.id=d.sucursal_id WHERE so.empresa_id<>t.empresa_id OR sd.empresa_id<>t.empresa_id`],
    ['transferencias/producto/empresa', `SELECT count(*)::int AS n FROM pos.transferencia_detalle d JOIN pos.transferencia_almacen t ON t.id=d.transferencia_id JOIN pos.producto p ON p.id=d.producto_id WHERE t.empresa_id<>p.empresa_id`],
    ['outbox/operacion duplicada', `SELECT count(*)::int AS n FROM (SELECT operation_id FROM pos.sincronizacion_ecommerce_inventario GROUP BY operation_id HAVING count(*)>1) d`],
    ['ajustes/idempotencia duplicada', `SELECT count(*)::int AS n FROM (SELECT empresa_id, clave_idempotencia FROM pos.ajuste_inventario GROUP BY empresa_id, clave_idempotencia HAVING count(*)>1) d`],
  ];
  await client.query('BEGIN');
  await client.query('SET TRANSACTION READ ONLY');
  try {
    for (const [name,sql] of checks) {
      try {
        const res = await client.query(sql);
        const n = res.rows[0].n;
        record(name, 'integridad', n === 0 ? 'PASS':'FAIL', `anomalías=${n}`);
      } catch(e) {
        record(name,'integridad','FAIL',safe(e.message));
        break; // PostgreSQL transaction aborted; do not misreport remaining checks
      }
    }
  } finally {await client.query('ROLLBACK');}
}
async function verifySnapshot(before, title) {
  const after = await snapshot();
  const changed = Object.keys(before).filter(t => JSON.stringify(before[t]) !== JSON.stringify(after[t]));
  record(title, 'integridad', changed.length ? 'FAIL' : 'PASS', changed.length ? `Cambios históricos: ${changed.join(', ')}. DETENER; revisar marcadores antes de intentar limpiar.` : 'Conteos y huellas de las tablas preservados.');
  if (changed.length) stopWrites = true;
  return changed.length === 0;
}
async function runHostProductHttp() {
  const label = 'Productos HTTP CRUD/roles/empresa';
  const file = 'tests/products-catalogo/test-products-http.mjs';
  const host = 'scripts/validation/http-host.mjs';
  if (![file,host].every(f=>existsSync(join(API,f)))) {record(label,'synthetic','SKIP','Falta archivo');return null;}
  let child;
  let log = '';
  let timer;
  try {
    const port = await new Promise((resolvePromise, rejectPromise) => {
      child = spawn(process.execPath,['--import','tsx',host],{cwd:API,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
      const recv = b => {
        log += safe(b.toString());
        const match = log.match(/INTEGRAL_HTTP_READY:(\d+)/);
        if (match) { clearTimeout(timer);resolvePromise(Number(match[1])); }
      };
      child.stdout.on('data',recv); child.stderr.on('data',recv);
      child.on('error',rejectPromise);
      child.once('exit',(code)=>rejectPromise(new Error(`Host HTTP terminó antes de estar listo: ${code}`)));
      timer = setTimeout(()=>rejectPromise(new Error('Timeout iniciando host HTTP')),30000);
    });
    return await runProcess(label,'synthetic',['--import','tsx',file], {timeout: 180000, env: {POS_HTTP_URL: `http://127.0.0.1:${port}`}});
  } catch(e) {record(label,'synthetic','FAIL',safe(e.message+' '+log.slice(-900)));return false;}
  finally {clearTimeout(timer); if(child && child.exitCode===null) child.kill();}
}
async function main() {
  console.log(`POSMYCLETH VALIDACIÓN INTEGRAL v2.0 (readonly enforce) | ${mode} | HEAD ${head.slice(0,8)}`);
  console.log(`Informe: ${folder}`);
  await client.connect(); connected=true;
  const targetDb = await client.query(`SELECT current_database() AS db, inet_server_port() AS port, current_user AS db_user, EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='pos') AS schema_ok`);
  assert.equal(targetDb.rows[0].db,'pos_novnix');
  assert.equal(targetDb.rows[0].port,5432);
  assert.equal(targetDb.rows[0].schema_ok,true);
  record('Destino PostgreSQL pos_novnix / pos', 'preflight', 'PASS');
  const original = await snapshot();
  // Historical count is captured *before* any synthetic operation. No legacy rows are deleted.
  env.POS_INTEGRAL_BASELINE_AUDIT_COUNT = String(original.auditoria.n);
  if(original.auditoria.n !== 44) warnings.push(
    `Auditoría histórica actual: ${original.auditoria.n}; el antiguo script de inventario asumía 44. ` +
    `Se conserva toda la historia; revisar eventos configuracion_empresa previos.`
  );
  const filesMissing = [...UNIT,...READONLY.flatMap(s=>s.files),...ROLLBACK.flatMap(s=>s.files),...SYNTHETIC.flatMap(s=>s.files)].filter(file=>!existsSync(join(API,file)));
  if (filesMissing.length) warnings.push(`Archivos de suites ausentes: ${filesMissing.join(', ')}`);
  // No schema generation here. If local generated Prisma is missing, typecheck reports it.
  await runProcess('TypeScript --noEmit','typecheck',['./node_modules/typescript/bin/tsc','--noEmit'], {timeout: 180000});
  const unitFiles = UNIT.filter(f=>existsSync(join(API,f)));
  if (unitFiles.length) await runProcess('Pruebas unitarias multi-módulo','unit',['--import','tsx','--test','--test-concurrency=1',...unitFiles],{
    timeout: 300000, env: readonlyDatabaseEnv
  });
  else record('Pruebas unitarias multi-módulo','unit','SKIP','No se encontraron');
  // Snapshot after every independently run suite to attribute any unexpected mutation.
  if (!fatal) await verifySnapshot(original,'Sin escrituras: pruebas unitarias');
  for (const s of READONLY) {
    if(fatal){record(s.title,s.group,'SKIP','Bloqueado por fallo previo');continue;}
    await runSuite(s, true);
    await verifySnapshot(original,`Sin escrituras: ${s.title}`);
  }
  if(!fatal) await integrity();
  else record('Integridad SQL','integridad','SKIP','Bloqueada por fallo previo');
  if(!fatal) await runProcess('Carga HTTP controlada (solo lectura)', 'performance', ['--import','tsx','tests/integral/http-load.readonly.mjs'], {
    timeout: 180000, env: readonlyDatabaseEnv
  });
  else record('Carga HTTP controlada (solo lectura)','performance','SKIP','Bloqueada por fallo previo');
  if(!fatal) await verifySnapshot(original,'Regresión sin escrituras');
  if (writeMode) {
    if (fatal) {
      for (const s of [...PREFLIGHTS,...ROLLBACK,...SYNTHETIC]) record(s.title,s.group,'SKIP','Bloqueada por fallo previo');
      record('Productos HTTP CRUD/roles/empresa','synthetic','SKIP','Bloqueada por fallo previo');
      return;
    }
    for (const s of PREFLIGHTS) {
      const ok = await runSuite(s, true);
      const intact = await verifySnapshot(original, `Sin escrituras: ${s.title}`);
      if (!ok || !intact) {stopWrites = true;break;}
    }
    for (const s of ROLLBACK) {
      if (stopWrites) {record(s.title,s.group,'SKIP','Bloqueada por fallo previo');continue;}
      const ok = await runSuite(s);
      const intact = await verifySnapshot(original, `Sin residuo: ${s.title}`);
      if (!ok || !intact) stopWrites = true;
    }
    if (!stopWrites) {
      const ok = await runHostProductHttp();
      const intact = await verifySnapshot(original,'Sin residuo: Productos HTTP');
      if (!ok || !intact) stopWrites=true;
    } else record('Productos HTTP CRUD/roles/empresa','synthetic','SKIP','Bloqueada por fallo previo');
    for (const s of SYNTHETIC) {
      if (stopWrites) {record(s.title,s.group,'SKIP','Bloqueada: revisar fallo/fixture antes de seguir');continue;}
      const ok = await runSuite(s);
      const intact = await verifySnapshot(original, `Sin residuo: ${s.title}`);
      if (!ok || !intact) stopWrites = true;
    }
    if (!stopWrites) {
      await integrity();
      await runProcess('TypeScript final --noEmit', 'final', ['./node_modules/typescript/bin/tsc','--noEmit'], {timeout:180000});
      await runProcess('Regresión unitaria final', 'final', ['--import','tsx','--test','--test-concurrency=1',...unitFiles],{
        timeout:300000, env:readonlyDatabaseEnv
      });
      await runSuite(suite('Regresión HTTP final Reportes', 'final', ['src/modules/reports/reports.http.integration.mjs'], ['--test']), true);
      await runSuite(suite('Regresión HTTP final Dashboard', 'final', ['src/modules/dashboard/dashboard.http.integration.mjs'], ['--test']), true);
      await verifySnapshot(original,'Huella final integral tras fixtures y regresión');
    }
  } else {
    for (const s of [...ROLLBACK,...SYNTHETIC]) record(s.title,s.group,'SKIP','Modo --audit: no se permiten escrituras sintéticas');
    record('Productos HTTP CRUD/roles/empresa','synthetic','SKIP','Modo --audit');
  }
  // Coverage constraints from the actual repo. Never label these as demonstrated.
  record('Aislamiento HTTP positivo entre dos empresas reales', 'coverage', 'SKIP', 'Requiere fixtures multiempresa válidos y pruebas de rutas para cada módulo');
  record('Multi-sucursal con acceso parcial real', 'coverage', 'SKIP', 'Falta caso positivo y negativo con usuario asignado');
  record('Ecommerce externo real', 'coverage', 'SKIP', 'Requiere entorno mock/staging separado, nunca Ecommerce de producción');
  record('Rendimiento bajo alto volumen y SLA', 'coverage', 'SKIP', 'La prueba disponible solo mide carga baja; sin umbral de producción establecido');
  record('Flujo venta + devolución + compra + transferencia EN UNA SOLA operación E2E', 'coverage','SKIP','Hay suites individuales; no existe todavía ese escenario integral atómico automatizado');
}
async function finalize() {
  const counts = Object.fromEntries(['PASS','FAIL','SKIP'].map(s=>[s,cases.filter(c=>c.status===s).length]));
  const complete = counts.FAIL === 0 && counts.SKIP === 0;
  const summary = {project:'POSMYCLETH', mode, started, finished:new Date().toISOString(), database:'pos_novnix', branch, commit:head, counts, complete, warnings, cases};
  await writeFile(join(folder,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  const sections = ['# POSMYCLETH — Validación integral', '',`- Modo: ${mode}`, `- Commit: ${head}`, `- Base: pos_novnix`, `- PASS: ${counts.PASS}; FAIL: ${counts.FAIL}; SKIP: ${counts.SKIP}`,`- **Estado: ${counts.FAIL?'RECHAZADA':counts.SKIP?'INCOMPLETA — PENDIENTES':'COMPLETA'}**`, '', '| Grupo | Prueba | Estado | Evidencia |','|---|---|---|---|',...cases.map(c=>`| ${c.group} | ${c.name.replace(/\|/g,'/')} | ${c.status} | ${(c.details||c.log||'').replace(/\|/g,'/').replace(/\n/g,' ')} |`),'','## Advertencias',...(warnings.length?warnings.map(w=>`- ${w}`):['- Sin advertencias adicionales.']),'','No aprobar para producción únicamente con esta corrida: faltan pruebas multiempresa/multisucursal reales, carga significativa y E2E integral.'];
  await writeFile(join(folder,'summary.md'),sections.join('\n')+'\n');
  console.log(`\nFINAL: PASS=${counts.PASS} FAIL=${counts.FAIL} SKIP=${counts.SKIP} => ${counts.FAIL?'RECHAZADA':'VALIDACIONES PARCIALES, pendientes visibles'}`);
  console.log(`Informe JSON/MD: ${folder}`);
  if (counts.FAIL) process.exitCode = 1;
}
try {await main();}
catch(e){record('Ejecución principal','infraestructura','FAIL',safe(e.stack||e.message));}
finally{if(connected) await client.end().catch(e=>record('Cerrar conexión PG','infraestructura','FAIL',e.message));await finalize();}
