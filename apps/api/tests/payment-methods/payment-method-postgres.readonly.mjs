/** SQL metadata and catalogue integration: READ ONLY and local dev guard. */
import "dotenv/config";
import assert from "node:assert/strict";
import pg from "pg";

const uri = process.env.DATABASE_URL;
const u = new URL(uri || "postgres://invalid/invalid");
assert.equal(process.env.POS_ALLOW_TEST_DB, "SI", "Definir POS_ALLOW_TEST_DB=SI exclusivamente en desarrollo.");
assert.ok(["postgres:", "postgresql:"].includes(u.protocol)
  && ["localhost", "127.0.0.1"].includes(u.hostname)
  && (!u.port || u.port === "5432") && u.pathname === "/pos_novnix",
  "PostgreSQL autorizado: localhost:5432/pos_novnix exclusivamente.");
const db = new pg.Client({ connectionString: uri, connectionTimeoutMillis: 5000 });
let connected = false, inTransaction = false, checks = 0;
function ok(message) { checks++; console.log(`[OK] ${message}`); }
try {
  await db.connect(); connected = true;
  await db.query("BEGIN READ ONLY"); inTransaction = true;
  const context = (await db.query("SELECT current_database() AS db, inet_server_port() AS port, current_setting('transaction_read_only') AS ro")).rows[0];
  assert.equal(context.db, "pos_novnix"); assert.equal(context.port, 5432); assert.equal(context.ro, "on");
  ok("Base local y transacción READ ONLY");

  const cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='pos' AND table_name='metodo_pago' ORDER BY ordinal_position")).rows.map(x => x.column_name);
  for (const name of ["id", "codigo", "nombre", "es_efectivo", "activo"]) assert.ok(cols.includes(name), `Falta columna ${name}`);
  assert.ok(!cols.includes("empresa_id"), "Se detectó un modelo por empresa distinto al esperado; inspeccionar antes de instalar.");
  ok("Esquema global esperado, sin empresa_id");

  const fks = await db.query(`SELECT source.relname AS origen, pg_get_constraintdef(c.oid) AS definicion
    FROM pg_constraint c JOIN pg_class source ON source.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=source.relnamespace
    WHERE n.nspname='pos' AND c.contype='f' AND c.confrelid='pos.metodo_pago'::regclass`);
  assert.ok(fks.rows.some(x=>x.origen==='venta_pago'), "Falta relación venta_pago");
  assert.ok(fks.rows.some(x=>x.origen==='compra_pago'), "Falta relación compra_pago");
  ok("Relaciones de compras y ventas conservadas");

  const methods = await db.query("SELECT id::text,codigo,nombre,es_efectivo,activo FROM pos.metodo_pago ORDER BY codigo,id");
  assert.ok(methods.rows.length >= 1, "No existen métodos de pago para las pruebas.");
  assert.ok(methods.rows.every(x => /^\d+$/.test(x.id) && typeof x.codigo === "string" && typeof x.es_efectivo === "boolean" && typeof x.activo === "boolean"));
  console.table(methods.rows);
  ok(`Catálogo leído sin modificaciones: ${methods.rows.length} métodos`);

  const noWrites = await db.query("SELECT count(*)::int AS n FROM pos.metodo_pago WHERE activo IS NOT NULL");
  assert.ok(noWrites.rows[0].n >= 1);
  ok("Lectura y filtrado del catálogo disponibles");
  console.log(`[OK] ${checks} comprobaciones PostgreSQL de solo lectura.`);
} catch (error) {
  process.exitCode = 1;
  console.error("[ERROR PAYMENT METHODS POSTGRES]", error);
} finally {
  if (connected) {
    if (inTransaction) await db.query("ROLLBACK").catch(() => {});
    await db.end().catch(() => {});
  }
  console.log(`CODIGO FINAL: ${process.exitCode || 0}`);
}
