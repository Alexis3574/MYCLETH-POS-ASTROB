/** Escribe SOLO datos sintéticos dentro de una transacción que SIEMPRE termina en ROLLBACK. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

assert.equal(process.env.POS_ALLOW_TEST_DB, 'SI', 'Requiere POS_ALLOW_TEST_DB=SI.');
const url = new URL(process.env.DATABASE_URL || 'postgres://invalid/invalid');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) &&
  ['localhost', '127.0.0.1'].includes(url.hostname) &&
  (!url.port || url.port === '5432') && url.pathname === '/pos_novnix', 'Solo pos_novnix local.');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
let connected = false, opened = false, checks = 0;
const marker = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const check = (description) => { checks++; console.log('[OK]', description); };
try {
  await db.connect(); connected = true;
  const state = (await db.query('SELECT current_database() AS name, inet_server_port() AS port, current_setting(\'transaction_read_only\') AS ro')).rows[0];
  assert.equal(state.name, 'pos_novnix'); assert.equal(state.port, 5432);
  await db.query('BEGIN'); opened = true;
  const company = (await db.query(`INSERT INTO pos.empresa(razon_social,nombre_comercial)
    VALUES ($1,$1) RETURNING id`, [`QTX_${marker}`])).rows[0].id;
  const branch = (await db.query(`INSERT INTO pos.sucursal(empresa_id,codigo,nombre)
    VALUES ($1,$2,$3) RETURNING id`, [company, `QTX${marker}`, 'Sucursal sintética'])).rows[0].id;
  const user = (await db.query(`INSERT INTO pos.usuario(empresa_id,username,password_hash,nombre)
    VALUES ($1,$2,'SYNTHETIC_NO_LOGIN','Quote Test') RETURNING id`, [company, `qtx_${marker}`])).rows[0].id;
  const unit = (await db.query(`INSERT INTO pos.unidad_medida(codigo,nombre,permite_decimales)
    VALUES ($1,'Unidad sintética',true) RETURNING id`, [`QTX_${marker}`])).rows[0].id;
  const product = (await db.query(`INSERT INTO pos.producto(empresa_id,unidad_medida_id,sku,nombre,precio_venta)
    VALUES ($1,$2,$3,'Producto sintético',100.00) RETURNING id`, [company, unit, `QTX_${marker}`])).rows[0].id;
  const quote = (await db.query(`INSERT INTO pos.cotizacion(empresa_id,sucursal_id,usuario_id,folio)
    VALUES ($1,$2,$3,$4) RETURNING id,estado`, [company, branch, user, `QTX_${marker}`])).rows[0];
  assert.equal(quote.estado, 'BORRADOR'); check('Cotización sintética insertada dentro de ROLLBACK');
  const detail = (await db.query(`INSERT INTO pos.cotizacion_detalle
    (cotizacion_id,producto_id,cantidad,precio_unitario,descuento_porcentaje,tasa_impuesto)
    VALUES ($1,$2,2.000,100.0000,10.0000,16.0000)
    RETURNING id,subtotal_linea::text,descuento_importe::text,impuesto_importe::text,total_linea::text`,
    [quote.id, product])).rows[0];
  assert.equal(detail.subtotal_linea, '200.00');
  assert.equal(detail.descuento_importe, '20.00');
  assert.equal(detail.impuesto_importe, '28.80');
  assert.equal(detail.total_linea, '208.80');
  check('Trigger de importes por línea con Decimal(14,2)');
  const total = (await db.query(`SELECT subtotal::text,descuento::text,impuesto::text,total::text
    FROM pos.cotizacion WHERE id=$1`, [quote.id])).rows[0];
  assert.deepEqual(total, { subtotal: '200.00', descuento: '20.00', impuesto: '28.80', total: '208.80' });
  check('Trigger de recálculo de totales en cabecera');
  await db.query('UPDATE pos.cotizacion_detalle SET cantidad=3.000 WHERE id=$1', [detail.id]);
  const updated = (await db.query('SELECT total::text FROM pos.cotizacion WHERE id=$1', [quote.id])).rows[0];
  assert.equal(updated.total, '313.20');
  check('Actualización recalcula 300 - 30 + 43.20 = 313.20');
  await db.query('DELETE FROM pos.cotizacion_detalle WHERE id=$1', [detail.id]);
  const zero = (await db.query('SELECT total::text FROM pos.cotizacion WHERE id=$1', [quote.id])).rows[0];
  assert.equal(zero.total, '0.00');
  check('Eliminación del detalle recalcula el total a cero');
} catch (error) {
  console.error('[ERROR QUOTE POSTGRES]', error);
  process.exitCode = 1;
} finally {
  if (connected) {
    if (opened) {
      try { await db.query('ROLLBACK'); console.log('[OK] ROLLBACK confirmado. Sin registros sintéticos persistentes.'); }
      catch (error) { console.error('[ERROR ROLLBACK]', error); process.exitCode = 1; }
    }
    await db.end().catch(() => {});
  }
  console.log(`COMPROBACIONES: ${checks}; CODIGO FINAL: ${process.exitCode || 0}`);
}
