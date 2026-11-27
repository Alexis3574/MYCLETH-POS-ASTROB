/** Read-only inspection of history affected by the original M15 HTTP suite. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL ?? 'postgres://invalid/invalid');
assert.ok(['postgres:','postgresql:'].includes(url.protocol));
assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
assert.ok(!url.port || url.port === '5432');
assert.equal(decodeURIComponent(url.pathname),'/pos_novnix');
assert.ok(!url.searchParams.has('host'));
url.searchParams.set('options',[url.searchParams.get('options'),'-c default_transaction_read_only=on'].filter(Boolean).join(' '));
const client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:10000,query_timeout:15000});
try {
  await client.connect();
  const check=await client.query("SELECT current_database() AS db, current_setting('transaction_read_only') AS read_only");
  assert.equal(check.rows[0]?.db,'pos_novnix');
  assert.equal(check.rows[0]?.read_only,'on');
  await client.query('BEGIN TRANSACTION READ ONLY');
  const totals=await client.query(`
    SELECT (SELECT count(*)::int FROM pos.auditoria) AS auditorias,
           (SELECT count(*)::int FROM pos.configuracion_empresa) AS configuraciones,
           (SELECT count(*)::int FROM pos.sincronizacion_ecommerce_inventario) AS eventos_outbox`);
  console.log('CONTEOS (solo lectura):');
  console.table(totals.rows);
  const recent=await client.query(`
    SELECT a.id::text AS auditoria_id, a.creado_en, a.accion,
           a.registro_id::text AS configuracion_id, c.clave
    FROM pos.auditoria a
    LEFT JOIN pos.configuracion_empresa c ON c.id=a.registro_id
    WHERE a.tabla='configuracion_empresa'
    ORDER BY a.id DESC LIMIT 12`);
  console.log('EVENTOS RECIENTES DE CONFIGURACION (sin valores ni credenciales):');
  console.table(recent.rows);
  const rows=await client.query(`
    SELECT empresa_id::text AS empresa_id, clave, count(*)::int AS registros
    FROM pos.configuracion_empresa GROUP BY empresa_id, clave
    ORDER BY empresa_id, clave`);
  console.log('CONFIGURACIONES EXISTENTES (sin valores):');
  console.table(rows.rows);
  await client.query('ROLLBACK');
  console.log('Inspeccion completada SIN modificaciones. No se han borrado eventos ni configuraciones.');
} finally {
  await client.query('ROLLBACK').catch(()=>{});
  await client.end().catch(()=>{});
}
