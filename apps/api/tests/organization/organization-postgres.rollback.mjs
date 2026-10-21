/** PostgreSQL integration test for organizational schema. Always rolls back synthetic rows. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const dbURL = new URL(process.env.DATABASE_URL || 'postgres://invalid/invalid');
assert.ok(['postgres:', 'postgresql:'].includes(dbURL.protocol) &&
  ['localhost', '127.0.0.1'].includes(dbURL.hostname) &&
  (!dbURL.port || dbURL.port === '5432') && dbURL.pathname === '/pos_novnix',
  'Requiere BD de desarrollo localhost:5432/pos_novnix');
assert.equal(process.env.POS_ALLOW_TEST_DB, 'SI', 'Exporta POS_ALLOW_TEST_DB=SI conscientemente.');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
let connected = false, inTransaction = false, checkCount = 0;
function ok(label) { checkCount++; console.log(`[OK] ${label}`); }
try {
  await client.connect(); connected = true;
  const v = await client.query('SELECT current_database() AS db, inet_server_port() AS port');
  assert.equal(v.rows[0].db, 'pos_novnix'); assert.equal(v.rows[0].port, 5432);
  await client.query('BEGIN'); inTransaction = true;
  await client.query('SET LOCAL search_path TO pos, pg_catalog');
  const suffix = randomUUID().replaceAll('-', '').slice(0,12);
  const company = (await client.query(
    'INSERT INTO pos.empresa(razon_social,nombre_comercial) VALUES ($1,$1) RETURNING id', [`ORG_PG_${suffix}`])).rows[0].id;
  ok('Empresa sintética en transacción');
  const branch = (await client.query(
    'INSERT INTO pos.sucursal(empresa_id,codigo,nombre) VALUES ($1,$2,$3) RETURNING id',
    [company, `B${suffix}`, 'Sucursal de ensayo'])).rows[0].id;
  const warehouse = (await client.query(
    'INSERT INTO pos.almacen(sucursal_id,codigo,nombre) VALUES ($1,$2,$3) RETURNING id',
    [branch, `W${suffix}`, 'Almacén de ensayo'])).rows[0].id;
  ok('Sucursales y almacenes existentes en la transacción');
  const links = await client.query(`SELECT b.empresa_id, w.sucursal_id FROM pos.almacen w
    JOIN pos.sucursal b ON b.id = w.sucursal_id WHERE w.id=$1`, [warehouse]);
  assert.equal(String(links.rows[0]?.empresa_id), String(company));
  assert.equal(String(links.rows[0]?.sucursal_id), String(branch));
  ok('Relaciones y pertenencia coherentes');
  await client.query('SAVEPOINT unique_branch');
  let duplicate = false;
  try {
    await client.query('INSERT INTO pos.sucursal(empresa_id,codigo,nombre) VALUES ($1,$2,$3)',
      [company, `B${suffix}`, 'Duplicada']);
  } catch (e) { duplicate = e.code === '23505'; }
  await client.query('ROLLBACK TO SAVEPOINT unique_branch');
  assert.ok(duplicate, 'Restricción UNIQUE (empresa_id, codigo) ausente');
  ok('UNIQUE sucursal-empresa protegida');
  await client.query('SAVEPOINT unique_warehouse');
  duplicate = false;
  try {
    await client.query('INSERT INTO pos.almacen(sucursal_id,codigo,nombre) VALUES ($1,$2,$3)',
      [branch, `W${suffix}`, 'Duplicada']);
  } catch (e) { duplicate = e.code === '23505'; }
  await client.query('ROLLBACK TO SAVEPOINT unique_warehouse');
  assert.ok(duplicate, 'Restricción UNIQUE (sucursal_id, codigo) ausente');
  ok('UNIQUE almacén-sucursal protegida');
  console.log(`[OK] ${checkCount} verificaciones de integración. Se revertirá TODO el fixture.`);
} catch (e) {
  console.error('[ERROR ORGANIZATION PG]', e);
  process.exitCode = 1;
} finally {
  if (connected) {
    if (inTransaction) {
      try { await client.query('ROLLBACK'); console.log('[OK] ROLLBACK confirmado: datos de ensayo revertidos.'); }
      catch(e) { process.exitCode = 1; console.error('[ERROR ROLLBACK]', e); }
    }
    await client.end();
  }
}
