/**
 * M13: isolated PostgreSQL concurrency regression against local pos_novnix.pos.
 * Modes: --preflight, --run, --cleanup-marker M13C_XXXXXXXXXX.
 * Internal mode --claim-one is only used by this test's child processes.
 * No Ecommerce requests. Synthetic inventory movements do activate
 * pos.fn_aplicar_movimiento_inventario(), so cleanup also removes existencia.
 * Stop ALL other POS instances and inventory synchronization workers first.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const mode = process.argv[2];
const markerRx = /^M13C_[A-F0-9]{10}$/;
const validModes = ['--preflight', '--run', '--cleanup-marker', '--claim-one'];
const marker = ['--cleanup-marker', '--claim-one'].includes(mode)
  ? process.argv[3]
  : `M13C_${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;

function safety(check, message) {
  if (!check) throw new Error(`[M13 CONCURRENCIA SEGURIDAD] ${message}`);
}
safety(validModes.includes(mode), 'Modo no permitido.');
safety(['--preflight', '--run'].includes(mode) ? process.argv.length === 3 : process.argv.length === (mode === '--claim-one' ? 5 : 4), 'Argumentos inesperados.');
safety(markerRx.test(marker), 'Marcador inválido.');
safety(process.env.POS_ALLOW_TEST_DB === 'SI', 'Se requiere POS_ALLOW_TEST_DB=SI.');
safety(process.env.INVENTORY_SYNC_ENABLED === 'false', 'Worker debe estar deshabilitado.');
safety(process.env.NODE_ENV !== 'production', 'No ejecutar en producción.');
safety(typeof process.env.DATABASE_URL === 'string', 'DATABASE_URL ausente.');
const target = new URL(process.env.DATABASE_URL);
safety(['postgres:', 'postgresql:'].includes(target.protocol), 'Solo PostgreSQL.');
safety(['localhost', '127.0.0.1'].includes(target.hostname), 'Solo base local.');
safety(!target.port || target.port === '5432', 'Solo puerto 5432.');
safety(decodeURIComponent(target.pathname) === '/pos_novnix', 'Base distinta de pos_novnix.');
safety(!target.searchParams.has('host'), 'Parámetro host prohibido.');
safety(!target.searchParams.has('schema') || target.searchParams.get('schema') === 'pos', 'Esquema distinto de pos.');

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const query = (sql, args = []) => db.query(sql, args);
const rows = async (sql, args = []) => (await query(sql, args)).rows;
const one = async (sql, args = []) => (await rows(sql, args))[0];
const insertId = async (sql, args = []) => String((await one(sql, args)).id);
let committed = false;
let passed = 0;
function pass(text) { passed++; console.log(`[PASS] ${text}`); }

async function snapshot() {
  return one(`SELECT
    (SELECT count(*)::int FROM pos.empresa) empresas,
    (SELECT count(*)::int FROM pos.sucursal) sucursales,
    (SELECT count(*)::int FROM pos.almacen) almacenes,
    (SELECT count(*)::int FROM pos.unidad_medida) unidades,
    (SELECT count(*)::int FROM pos.producto) productos,
    (SELECT count(*)::int FROM pos.movimiento_inventario) movimientos,
    (SELECT count(*)::int FROM pos.existencia) existencias,
    (SELECT count(*)::int FROM pos.auditoria) auditorias,
    (SELECT count(*)::int FROM pos.sincronizacion_ecommerce_inventario) outbox,
    (SELECT COALESCE(sum(intentos),0)::text FROM pos.sincronizacion_ecommerce_inventario) intentos,
    (SELECT md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), ''))
       FROM pos.sincronizacion_ecommerce_inventario s) outbox_hash`);
}

async function preflight() {
  const server = await one(`SELECT current_database() AS db,
     inet_server_port() AS port,
     EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='pos') AS schema_ok`);
  safety(server.db === 'pos_novnix' && server.port === 5432 && server.schema_ok,
    'Instancia PostgreSQL inesperada.');
  const active = await one(`SELECT count(*)::int AS n
     FROM pos.sincronizacion_ecommerce_inventario WHERE estado <> 'SINCRONIZADO'`);
  safety(active.n === 0, `Existen ${active.n} eventos no sincronizados ajenos a la prueba. No se ejecutarán operaciones globales.`);
  const triggers = await rows(`SELECT t.tgname FROM pg_trigger t
     JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='pos' AND c.relname='movimiento_inventario' AND NOT t.tgisinternal`);
  safety(triggers.some(t => t.tgname === 'trg_movimiento_inventario_aplicar'),
    'Falta el trigger esperado de inventario.');
  const fn = await one("SELECT pg_get_functiondef('pos.fn_aplicar_movimiento_inventario()'::regprocedure) AS definition");
  safety(fn?.definition, 'Definición del trigger de inventario no disponible.');
  console.log('===== FUNCIÓN QUE EJECUTA EL TRIGGER =====\n' + fn.definition);
  const before = await snapshot();
  console.log('[M13C] PREFLIGHT:', JSON.stringify({ outbox: before.outbox, eventos_no_sincronizados: active.n }));
  return before;
}

async function createFixture() {
  console.log('[M13C] MARCADOR DE RECUPERACIÓN:', marker);
  await query('BEGIN');
  try {
    await query("SET LOCAL lock_timeout='5s'");
    await query("SET LOCAL statement_timeout='20000ms'");
    const unit = await insertId(`INSERT INTO pos.unidad_medida(codigo,nombre,permite_decimales)
       VALUES ($1,$2,false) RETURNING id::text`, [`UNIT_${marker}`, `Unidad ${marker}`]);
    const company = await insertId(`INSERT INTO pos.empresa(razon_social,nombre_comercial)
       VALUES ($1,$1) RETURNING id::text`, [marker]);
    const branch = await insertId(`INSERT INTO pos.sucursal(empresa_id,codigo,nombre)
       VALUES ($1,$2,$3) RETURNING id::text`, [company, `S_${marker}`, `Sucursal ${marker}`]);
    const warehouse = await insertId(`INSERT INTO pos.almacen(sucursal_id,codigo,nombre)
       VALUES ($1,$2,$3) RETURNING id::text`, [branch, `A_${marker}`, `Almacén ${marker}`]);
    const product = await insertId(`INSERT INTO pos.producto
       (empresa_id,unidad_medida_id,sku,codigo_barras,nombre,precio_venta,costo_referencia,tipo,controla_inventario)
       VALUES ($1,$2,$3,$4,$5,100.00,0.0000,'PRODUCTO',true) RETURNING id::text`,
       [company, unit, `SKU_${marker}`, `BAR_${marker}`, `Producto ${marker}`]);
    const movement = await insertId(`INSERT INTO pos.movimiento_inventario
       (producto_id,almacen_id,tipo,cantidad,costo_unitario,documento_tipo,motivo)
       VALUES ($1,$2,'ENTRADA',1.000,0.0000,'TEST_M13C',$3) RETURNING id::text`,
       [product, warehouse, marker]);
    const existence = await one(`SELECT cantidad::text AS cantidad, reservado::text AS reservado
       FROM pos.existencia WHERE producto_id=$1 AND almacen_id=$2`, [product, warehouse]);
    assert.ok(existence, 'Trigger no produjo existencia sintética.');
    assert.equal(Number(existence.cantidad), 1, 'Existencia sintética inesperada.');
    assert.equal(Number(existence.reservado), 0, 'Reserva sintética inesperada.');
    const event = await insertId(`INSERT INTO pos.sincronizacion_ecommerce_inventario
       (movimiento_inventario_id,operation_id,codigo_barras,sku,adjustment,estado)
       VALUES ($1,$2,NULL,$3,1,'PENDIENTE') RETURNING id::text`,
       [movement, marker, `SKU_${marker}`]);
    await query('COMMIT');
    committed = true;
    pass('Fixture completamente sintético creado; trigger de existencia verificado');
    return { company, branch, warehouse, unit, product, movement, event };
  } catch (error) {
    await query('ROLLBACK').catch(() => {});
    throw error;
  }
}

/** Cleanup refuses incomplete or unexpected ownership rather than guessing. */
async function cleanup(tag) {
  safety(markerRx.test(tag), 'Marcador de limpieza inválido.');
  await query('BEGIN');
  try {
    await query("SET LOCAL lock_timeout='5s'");
    await query("SET LOCAL statement_timeout='20000ms'");
    const companies = await rows(`SELECT id::text AS id,razon_social,nombre_comercial
      FROM pos.empresa WHERE razon_social=$1 FOR UPDATE`, [tag]);
    const units = await rows(`SELECT id::text AS id,codigo,nombre
      FROM pos.unidad_medida WHERE codigo=$1 FOR UPDATE`, [`UNIT_${tag}`]);
    if (companies.length === 0 && units.length === 0) {
      await query('ROLLBACK');
      console.log('[M13C] Marcador inexistente: ninguna fila para limpiar.');
      return;
    }
    assert.equal(companies.length, 1, 'Empresa sintética ausente o duplicada.');
    assert.equal(units.length, 1, 'Unidad sintética ausente o duplicada.');
    const company = companies[0], unit = units[0];
    assert.equal(company.nombre_comercial, tag);
    assert.equal(unit.nombre, `Unidad ${tag}`);
    const branches = await rows(`SELECT id::text AS id,codigo,nombre FROM pos.sucursal
      WHERE empresa_id=$1 FOR UPDATE`, [company.id]);
    assert.equal(branches.length, 1, 'Otras sucursales en empresa sintética.');
    const branch = branches[0];
    assert.equal(branch.codigo, `S_${tag}`);
    assert.equal(branch.nombre, `Sucursal ${tag}`);
    const warehouses = await rows(`SELECT id::text AS id,codigo,nombre FROM pos.almacen
      WHERE sucursal_id=$1 FOR UPDATE`, [branch.id]);
    assert.equal(warehouses.length, 1, 'Otros almacenes en sucursal sintética.');
    const warehouse = warehouses[0];
    assert.equal(warehouse.codigo, `A_${tag}`);
    assert.equal(warehouse.nombre, `Almacén ${tag}`);
    const products = await rows(`SELECT id::text AS id,unidad_medida_id::text AS unidad_id,
      sku,codigo_barras,nombre,tipo,controla_inventario FROM pos.producto
      WHERE empresa_id=$1 FOR UPDATE`, [company.id]);
    assert.equal(products.length, 1, 'Otros productos en empresa sintética.');
    const product = products[0];
    assert.equal(product.unidad_id, unit.id);
    assert.equal(product.sku, `SKU_${tag}`);
    assert.equal(product.codigo_barras, `BAR_${tag}`);
    assert.equal(product.nombre, `Producto ${tag}`);
    assert.equal(product.tipo, 'PRODUCTO');
    assert.equal(product.controla_inventario, true);
    const movements = await rows(`SELECT id::text AS id,producto_id::text AS producto_id,
      almacen_id::text AS almacen_id,tipo,cantidad::text AS cantidad,documento_tipo,motivo
      FROM pos.movimiento_inventario WHERE producto_id=$1 FOR UPDATE`, [product.id]);
    assert.equal(movements.length, 1, 'Otros movimientos para producto sintético.');
    const movement = movements[0];
    assert.equal(movement.almacen_id, warehouse.id);
    assert.equal(movement.tipo, 'ENTRADA');
    assert.equal(Number(movement.cantidad), 1);
    assert.equal(movement.documento_tipo, 'TEST_M13C');
    assert.equal(movement.motivo, tag);
    const events = await rows(`SELECT id::text AS id,movimiento_inventario_id::text AS movimiento_id,
      operation_id,codigo_barras,sku,adjustment,estado,intentos,ecommerce_product_id,sincronizado_en,
      ultimo_error FROM pos.sincronizacion_ecommerce_inventario
      WHERE movimiento_inventario_id=$1 FOR UPDATE`, [movement.id]);
    assert.equal(events.length, 1, 'Outbox sintético ausente o duplicado.');
    const event = events[0];
    assert.equal(event.operation_id, tag);
    assert.equal(event.codigo_barras, null);
    assert.equal(event.sku, `SKU_${tag}`);
    assert.equal(event.adjustment, 1);
    assert.ok(['PENDIENTE','PROCESANDO','AGOTADO'].includes(event.estado), 'Evento tocado por procesamiento externo.');
    assert.ok(event.intentos >= 0 && event.intentos <= 10, 'Intentos inesperados.');
    assert.equal(event.ecommerce_product_id, null);
    assert.equal(event.sincronizado_en, null);
    assert.ok(event.ultimo_error === null || event.ultimo_error.startsWith('M13C_TEST_'), 'Error ajeno a la prueba.');
    const stocks = await rows(`SELECT producto_id::text AS producto_id, almacen_id::text AS almacen_id,
      cantidad::text AS cantidad,reservado::text AS reservado FROM pos.existencia
      WHERE producto_id=$1 OR almacen_id=$2 FOR UPDATE`, [product.id, warehouse.id]);
    assert.equal(stocks.length, 1, 'Existencias inesperadas en fixture sintético.');
    assert.equal(stocks[0].producto_id, product.id);
    assert.equal(stocks[0].almacen_id, warehouse.id);
    assert.equal(Number(stocks[0].cantidad), 1);
    assert.equal(Number(stocks[0].reservado), 0);
    async function remove(sql, args) {
      const result = await query(sql, args);
      assert.equal(result.rowCount, 1, 'Cantidad eliminada inesperada; se revierte limpieza.');
    }
    await remove('DELETE FROM pos.sincronizacion_ecommerce_inventario WHERE id=$1 AND operation_id=$2', [event.id, tag]);
    await remove('DELETE FROM pos.existencia WHERE producto_id=$1 AND almacen_id=$2', [product.id, warehouse.id]);
    await remove('DELETE FROM pos.movimiento_inventario WHERE id=$1 AND motivo=$2', [movement.id, tag]);
    await remove('DELETE FROM pos.producto WHERE id=$1 AND sku=$2', [product.id, `SKU_${tag}`]);
    await remove('DELETE FROM pos.almacen WHERE id=$1 AND codigo=$2', [warehouse.id, `A_${tag}`]);
    await remove('DELETE FROM pos.sucursal WHERE id=$1 AND codigo=$2', [branch.id, `S_${tag}`]);
    await remove('DELETE FROM pos.empresa WHERE id=$1 AND razon_social=$2', [company.id, tag]);
    await remove('DELETE FROM pos.unidad_medida WHERE id=$1 AND codigo=$2', [unit.id, `UNIT_${tag}`]);
    await query('COMMIT');
    console.log('[PASS] Limpieza de movimiento, existencia, producto, outbox y estructuras sintéticas.');
  } catch (error) {
    await query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function claimChild() {
  const eventId = process.argv[4];
  safety(/^[1-9]\d{0,18}$/.test(eventId || ''), 'ID de evento inválido.');
  const { prisma } = await import('../../src/lib/prisma.js');
  try {
    const event = await prisma.sincronizacion_ecommerce_inventario.findUnique({
      where: { id: BigInt(eventId) }, select: { operation_id: true, estado: true }
    });
    safety(event?.operation_id === marker, 'Reclamación fuera del fixture.');
    process.stdout.write('READY\n');
    await new Promise((resolve, reject) => {
      process.stdin.once('data', data => data.toString().trim() === 'GO' ? resolve() : reject(new Error('GO ausente.')));
      process.stdin.once('error', reject);
    });
    const { inventorySyncRepository } = await import('../../src/modules/inventory-sync/inventory-sync.repository.js');
    const result = await inventorySyncRepository.tryClaim(BigInt(eventId));
    process.stdout.write('RESULT:' + JSON.stringify(result) + '\n');
  } finally {
    await prisma.$disconnect();
  }
}

function startClaimProcess(eventId) {
  const child = spawn(process.execPath,
    ['--import', 'tsx', fileURLToPath(import.meta.url), '--claim-one', marker, eventId],
    { cwd: process.cwd(), env: process.env, stdio: ['pipe','pipe','pipe'] });
  const watchdog = setTimeout(() => child.kill(), 30000);
  let stdout = '', stderr = '', readyDone = false;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve,reject) => { resolveReady=resolve; rejectReady=reject; });
  const done = new Promise((resolve,reject) => {
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (!readyDone && stdout.includes('READY\n')) { readyDone = true; resolveReady(); }
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', error => { rejectReady(error); reject(error); });
    child.once('close', code => {
      clearTimeout(watchdog);
      if (!readyDone) rejectReady(new Error('Worker hijo terminó sin READY: ' + stderr));
      if (code !== 0) return reject(new Error(`Worker hijo falló (${code}): ${stderr}\n${stdout}`));
      const match = stdout.match(/^RESULT:(\{.*\})$/m);
      if (!match) return reject(new Error('RESULT ausente: ' + stdout));
      resolve(JSON.parse(match[1]));
    });
  });
  // If a sibling fails during readiness, suppress premature unhandled rejection.
  void done.catch(() => {});
  return { child, ready, done };
}

async function forceUpdate(sql, args) {
  const result = await query(sql, args);
  assert.equal(result.rowCount, 1, 'Actualización de fixture no autorizada.');
}
async function stateOf(event) {
  return one(`SELECT estado,intentos,ultimo_error FROM pos.sincronizacion_ecommerce_inventario
     WHERE id=$1 AND operation_id=$2`, [event, marker]);
}

async function runCases(ids) {
  const { prisma } = await import('../../src/lib/prisma.js');
  const { inventorySyncRepository: repo } = await import('../../src/modules/inventory-sync/inventory-sync.repository.js');
  const event = BigInt(ids.event);
  try {
    const processes = [startClaimProcess(ids.event), startClaimProcess(ids.event)];
    try {
      await Promise.all(processes.map(p => p.ready));
      processes.forEach(p => p.child.stdin.end('GO\n'));
      const results = await Promise.all(processes.map(p => p.done));
      assert.equal(results.filter(x => x.count === 1).length, 1);
      assert.equal(results.filter(x => x.count === 0).length, 1);
      assert.equal(results.find(x => x.count === 1).attempts, 1);
    } finally {
      for (const p of processes) {
        if (!p.child.killed && p.child.exitCode === null) p.child.kill();
      }
    }
    assert.deepEqual(await stateOf(ids.event), { estado:'PROCESANDO',intentos:1,ultimo_error:null });
    pass('Dos procesos independientes: exactamente una reclamación y un intento');

    const failed1 = await repo.markFailed(event, 'M13C_TEST_FAIL_1', 1);
    assert.equal(failed1.count, 1);
    assert.equal((await repo.tryClaim(event)).count, 0);
    pass('Backoff bloquea el reintento inmediato');

    await forceUpdate(`UPDATE pos.sincronizacion_ecommerce_inventario
      SET ultimo_intento_en=now()-interval '1 hour'
      WHERE id=$1 AND operation_id=$2 AND estado='PENDIENTE' AND intentos=1`, [ids.event, marker]);
    const claimed2 = await repo.tryClaim(event);
    assert.deepEqual(claimed2, { count: 1, attempts: 2, mode: "AUTO" });
    pass('Reintento permitido tras cumplir la espera');

    await forceUpdate(`UPDATE pos.sincronizacion_ecommerce_inventario
      SET ultimo_intento_en=now()-interval '1 hour'
      WHERE id=$1 AND operation_id=$2 AND estado='PROCESANDO' AND intentos=2`, [ids.event, marker]);
    const recovered = await repo.requeueStaleProcessing(new Date(Date.now()-120000));
    assert.equal(recovered.count,1);
    assert.equal((await stateOf(ids.event)).estado, 'PENDIENTE');
    const claimed3 = await repo.tryClaim(event);
    assert.deepEqual(claimed3, { count: 1, attempts: 3, mode: "AUTO" });
    assert.equal((await repo.markSynchronized(event,1n,2)).count,0);
    assert.equal((await repo.markFailed(event,'M13C_TEST_STALE',2)).count,0);
    assert.deepEqual(await stateOf(ids.event), { estado:'PROCESANDO',intentos:3,ultimo_error:'M13C_TEST_FAIL_1' });
    pass('Timeout recuperado; dos finalizaciones tardías rechazadas tras el tercer claim');

    assert.equal((await repo.markFailed(event,'M13C_TEST_FAIL_3',3)).count,1);
    await forceUpdate(`UPDATE pos.sincronizacion_ecommerce_inventario
      SET intentos=9, ultimo_intento_en=now()-interval '1 day'
      WHERE id=$1 AND operation_id=$2 AND estado='PENDIENTE' AND intentos=3`, [ids.event, marker]);
    const claimed10 = await repo.tryClaim(event);
    assert.deepEqual(claimed10, { count: 1, attempts: 10, mode: "AUTO" });
    assert.equal((await repo.markFailed(event,'M13C_TEST_FAIL_10',10)).count,1);
    assert.equal((await stateOf(ids.event)).estado,'AGOTADO');
    assert.equal((await repo.tryClaim(event)).count,0);
    assert.ok(!(await repo.findPending(20)).some(row => row.id === event));
    pass('Décimo fallo pasa a AGOTADO y ya no se reclama');

    await forceUpdate(`UPDATE pos.sincronizacion_ecommerce_inventario
      SET estado='PROCESANDO',ultimo_intento_en=now()-interval '1 hour'
      WHERE id=$1 AND operation_id=$2 AND estado='AGOTADO' AND intentos=10`, [ids.event, marker]);
    const recoveredExhausted = await repo.requeueStaleProcessing(new Date(Date.now()-120000));
    assert.equal(recoveredExhausted.exhausted,1);
    assert.equal((await stateOf(ids.event)).estado,'AGOTADO');
    pass('Procesamiento estancado con 10 intentos pasa a AGOTADO');

    await forceUpdate(`UPDATE pos.sincronizacion_ecommerce_inventario
      SET estado='PENDIENTE' WHERE id=$1 AND operation_id=$2 AND estado='AGOTADO' AND intentos=10`, [ids.event, marker]);
    const exhaustedPending = await repo.markExhaustedPending();
    assert.equal(exhaustedPending.count,1);
    assert.equal((await stateOf(ids.event)).estado,'AGOTADO');
    pass('Pendiente agotado se clasifica sin intervención en Ecommerce');

    const other = await one(`SELECT count(*)::int n FROM pos.sincronizacion_ecommerce_inventario
      WHERE operation_id <> $1 AND estado <> 'SINCRONIZADO'`, [marker]);
    assert.equal(other.n,0,'Aparecieron eventos externos no sincronizados.');
    pass('Sin afectación de eventos externos al fixture');
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (mode === '--claim-one') return claimChild();
  await db.connect();
  try {
    if (mode === '--cleanup-marker') {
      await cleanup(marker);
      return;
    }
    const before = await preflight();
    if (mode === '--preflight') {
      console.log('[M13C] PRE-FLIGHT aprobado; sin escrituras.');
      return;
    }
    let error = null;
    try {
      const fixture = await createFixture();
      await runCases(fixture);
    } catch (e) { error = e; }
    finally {
      if (committed) {
        await cleanup(marker);
        const after = await snapshot();
        assert.deepEqual(after,before,'Los datos históricos o los conteos no se restauraron.');
        console.log('[PASS] Conteos y huella histórica del outbox restaurados.');
      }
    }
    if (error) throw error;
    console.log(`[M13C] CONCURRENCIA APROBADA: ${passed} verificaciones.`);
  } finally {
    await db.end();
  }
}

main().catch(error => {
  console.error('[M13C ERROR]',error);
  if (mode === '--run') {
    console.error('[M13C MARCADOR]',marker);
    console.error('[M13C RECUPERACIÓN] --cleanup-marker',marker);
  }
  process.exitCode = 1;
});
