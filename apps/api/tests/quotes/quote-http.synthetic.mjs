/** E2E transaccional: fixtures HTTP en dos empresas; limpiar solo marcadores propios, con salvaguardas. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import pg from 'pg';

assert.equal(process.env.POS_ALLOW_TEST_DB, 'SI', 'Definir POS_ALLOW_TEST_DB=SI para datos sintéticos.');
const connectionString = process.env.DATABASE_URL;
const url = new URL(connectionString || 'postgres://invalid/invalid');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol) &&
  ['localhost', '127.0.0.1'].includes(url.hostname) && (!url.port || url.port === '5432') &&
  url.pathname === '/pos_novnix', 'Solo PostgreSQL localhost:5432/pos_novnix.');
const api = new URL(process.env.POS_HTTP_URL || 'http://127.0.0.1:3000');
assert.ok(api.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(api.hostname) &&
  !api.search && !api.hash && ['','/'].includes(api.pathname), 'Solo API HTTP local.');
assert.ok((process.env.JWT_SECRET || '').length >= 16, 'JWT_SECRET de desarrollo requerido.');

const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const marker = `QHTTP_${suffix}`;
const prefix = `Q${suffix}`;
const secret = new TextEncoder().encode(process.env.JWT_SECRET);
const db = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
let connected = false, tx = false, fixture = null, checks = 0;
function ok(msg) { checks++; console.log('[OK]', msg); }
async function send(method, path, token, body) {
  const response = await fetch(new URL(path, api), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}
async function expect(status, msg, method, path, token, body) {
  const result = await send(method, path, token, body);
  assert.equal(result.status, status, `${msg}: ${result.status}, esperado ${status}: ${result.data?.message || ''}`);
  ok(`${msg}: HTTP ${status}`);
  return result.data;
}
async function token(user) {
  return new SignJWT({ empresa_id: user.company })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id).setIssuer('pos-api').setAudience('pos-web')
    .setIssuedAt().setExpirationTime('15m').sign(secret);
}
async function setup() {
  await db.query('BEGIN'); tx = true;
  try {
    const permissionRows = (await db.query(`SELECT id::text, codigo FROM pos.permiso
      WHERE codigo IN ('COTIZACIONES.VER','COTIZACIONES.CREAR')`)).rows;
    assert.equal(permissionRows.length, 2, 'Faltan permisos de Cotizaciones.');
    const unit = String((await db.query(`INSERT INTO pos.unidad_medida(codigo,nombre,permite_decimales)
      VALUES ($1,'Unidad sintética cotizaciones',true) RETURNING id`, [`QUNIT_${suffix}`])).rows[0].id);
    const role = String((await db.query(`INSERT INTO pos.rol(codigo,nombre)
      VALUES ($1,$2) RETURNING id`, [`QR_${suffix}`, marker])).rows[0].id);
    for (const perm of permissionRows) {
      await db.query('INSERT INTO pos.rol_permiso(rol_id,permiso_id) VALUES ($1,$2)', [role, perm.id]);
    }
    const entities = [];
    for (const label of ['A', 'B']) {
      const company = String((await db.query(`INSERT INTO pos.empresa(razon_social,nombre_comercial)
        VALUES ($1,$1) RETURNING id`, [`${marker}_${label}`])).rows[0].id);
      const branch = String((await db.query(`INSERT INTO pos.sucursal(empresa_id,codigo,nombre)
        VALUES ($1,$2,$2) RETURNING id`, [company, `${prefix}_${label}`])).rows[0].id);
      const username = `qhttp_${suffix.toLowerCase()}_${label.toLowerCase()}`;
      const user = String((await db.query(`INSERT INTO pos.usuario(empresa_id,username,password_hash,nombre)
        VALUES ($1,$2,'SYNTHETIC_NO_LOGIN','E2E Cotizaciones') RETURNING id`, [company, username])).rows[0].id);
      await db.query('INSERT INTO pos.usuario_rol(usuario_id,rol_id) VALUES($1,$2)', [user, role]);
      await db.query('INSERT INTO pos.usuario_sucursal(usuario_id,sucursal_id) VALUES($1,$2)', [user, branch]);
      const sku = `${prefix}_${label}`;
      const product = String((await db.query(`INSERT INTO pos.producto(empresa_id,unidad_medida_id,sku,nombre,precio_venta,tipo,controla_inventario)
        VALUES ($1,$2,$3,$3,100.00,'SERVICIO',false) RETURNING id`, [company, unit, sku])).rows[0].id);
      const customer = String((await db.query(`INSERT INTO pos.cliente(empresa_id,codigo,nombre)
        VALUES ($1,$2,$2) RETURNING id`, [company, sku])).rows[0].id);
      entities.push({ label, company, branch, id: user, username, product, customer });
    }
    const tax = String((await db.query(`INSERT INTO pos.impuesto(empresa_id,codigo,nombre,tasa)
      VALUES ($1,$2,'Impuesto sintético',16.0000) RETURNING id`, [entities[0].company, `QTAX_${suffix}`])).rows[0].id);
    await db.query('INSERT INTO pos.producto_impuesto(producto_id,impuesto_id) VALUES($1,$2)', [entities[0].product, tax]);
    await db.query('COMMIT'); tx = false;
    fixture = { companies: entities.map(x => x.company), branches: entities.map(x => x.branch),
      products: entities.map(x => x.product), customers: entities.map(x => x.customer),
      users: entities.map(x => x.id), entities, role, unit, tax };
    ok(`Fixture confirmado: ${marker}`);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {}); tx = false;
    throw error;
  }
}
async function cleanup() {
  if (!fixture) return;
  await db.query('BEGIN'); tx = true;
  try {
    const companies = (await db.query(`SELECT id::text, razon_social FROM pos.empresa
      WHERE id=ANY($1::bigint[]) FOR UPDATE`, [fixture.companies])).rows;
    assert.equal(companies.length, 2);
    assert.deepEqual(companies.map(x=>x.razon_social).sort(), [`${marker}_A`,`${marker}_B`].sort());
    const branches = (await db.query(`SELECT id::text,codigo FROM pos.sucursal
      WHERE empresa_id=ANY($1::bigint[])`, [fixture.companies])).rows;
    assert.deepEqual(branches.map(x=>x.id).sort(), fixture.branches.slice().sort(), 'Sucursales ajenas.');
    assert.ok(branches.every(x=>x.codigo.toUpperCase().startsWith(prefix)), 'Código de sucursal ajena.');
    const users = (await db.query(`SELECT id::text,username FROM pos.usuario
      WHERE empresa_id=ANY($1::bigint[])`, [fixture.companies])).rows;
    assert.deepEqual(users.map(x=>x.id).sort(),fixture.users.slice().sort(), 'Usuarios ajenos.');
    assert.ok(users.every(x=>x.username.startsWith(`qhttp_${suffix.toLowerCase()}_`)), 'Usuario ajeno.');
    const products = (await db.query(`SELECT id::text,sku FROM pos.producto
      WHERE empresa_id=ANY($1::bigint[])`, [fixture.companies])).rows;
    assert.deepEqual(products.map(x=>x.id).sort(), fixture.products.slice().sort(), 'Productos ajenos.');
    assert.ok(products.every(x=>x.sku.startsWith(prefix)), 'SKU ajeno.');
    const customers = (await db.query(`SELECT id::text,codigo FROM pos.cliente
      WHERE empresa_id=ANY($1::bigint[])`, [fixture.companies])).rows;
    assert.deepEqual(customers.map(x=>x.id).sort(), fixture.customers.slice().sort(), 'Clientes ajenos.');
    const taxRows = (await db.query(`SELECT id::text,codigo FROM pos.impuesto
      WHERE empresa_id=ANY($1::bigint[])`, [fixture.companies])).rows;
    assert.deepEqual(taxRows.map(x=>x.id), [fixture.tax], 'Impuestos ajenos.');
    const role = (await db.query('SELECT codigo FROM pos.rol WHERE id=$1', [fixture.role])).rows;
    assert.equal(role[0]?.codigo, `QR_${suffix}`);
    const unit = (await db.query('SELECT codigo FROM pos.unidad_medida WHERE id=$1', [fixture.unit])).rows;
    assert.equal(unit[0]?.codigo, `QUNIT_${suffix}`);
    const quotes = (await db.query(`SELECT id::text,folio FROM pos.cotizacion
      WHERE empresa_id=ANY($1::bigint[])`, [fixture.companies])).rows;
    assert.ok(quotes.every(x=>x.folio.startsWith(prefix)), 'Cotización ajena.');
    const qids = quotes.map(x=>x.id);
    for (const table of ['venta','compra','orden_venta','pedido_cliente','transferencia_almacen','proveedor']) {
      const n = Number((await db.query(`SELECT count(*) AS n FROM pos.${table}
        WHERE empresa_id=ANY($1::bigint[])`, [fixture.companies])).rows[0].n);
      assert.equal(n, 0, `Hay registros ${table} ajenos.`);
    }
    const auditing = (await db.query(`SELECT id,tabla,registro_id::text,accion FROM pos.auditoria
      WHERE usuario_id=ANY($1::bigint[])`, [fixture.users])).rows;
    assert.ok(auditing.every(x=>x.tabla==='cotizacion' && qids.includes(x.registro_id)), 'Auditoría ajena.');
    const assignments = (await db.query(`SELECT usuario_id::text,sucursal_id::text FROM pos.usuario_sucursal
      WHERE usuario_id=ANY($1::bigint[])`, [fixture.users])).rows;
    assert.equal(assignments.length, 2);
    assert.ok(assignments.every(x=>fixture.users.includes(x.usuario_id) && fixture.branches.includes(x.sucursal_id)));
    await db.query('DELETE FROM pos.auditoria WHERE usuario_id=ANY($1::bigint[])', [fixture.users]);
    await db.query('DELETE FROM pos.cotizacion_detalle WHERE cotizacion_id=ANY($1::bigint[])', [qids]);
    await db.query('DELETE FROM pos.cotizacion WHERE id=ANY($1::bigint[])', [qids]);
    await db.query('DELETE FROM pos.producto_impuesto WHERE producto_id=ANY($1::bigint[])', [fixture.products]);
    await db.query('DELETE FROM pos.impuesto WHERE id=$1', [fixture.tax]);
    await db.query('DELETE FROM pos.cliente WHERE id=ANY($1::bigint[])', [fixture.customers]);
    await db.query('DELETE FROM pos.producto WHERE id=ANY($1::bigint[])', [fixture.products]);
    await db.query('DELETE FROM pos.usuario_rol WHERE usuario_id=ANY($1::bigint[])', [fixture.users]);
    await db.query('DELETE FROM pos.usuario_sucursal WHERE usuario_id=ANY($1::bigint[])', [fixture.users]);
    await db.query('DELETE FROM pos.sucursal WHERE id=ANY($1::bigint[])', [fixture.branches]);
    await db.query('DELETE FROM pos.usuario WHERE id=ANY($1::bigint[])', [fixture.users]);
    await db.query('DELETE FROM pos.rol_permiso WHERE rol_id=$1', [fixture.role]);
    await db.query('DELETE FROM pos.rol WHERE id=$1', [fixture.role]);
    await db.query('DELETE FROM pos.empresa WHERE id=ANY($1::bigint[])', [fixture.companies]);
    await db.query('DELETE FROM pos.unidad_medida WHERE id=$1', [fixture.unit]);
    await db.query('COMMIT'); tx = false; fixture = null;
    ok('Limpieza transaccional confirmada.');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {}); tx = false;
    console.error(`[ERROR LIMPIEZA] ${marker}; empresas ${fixture.companies.join(',')}. NO REPETIR.`);
    throw error;
  }
}

try {
  await db.connect(); connected = true;
  const context = (await db.query('SELECT current_database() AS db,inet_server_port() AS port')).rows[0];
  assert.equal(context.db, 'pos_novnix'); assert.equal(context.port, 5432);
  ok('PostgreSQL de desarrollo confirmado');
  await expect(401, 'JWT requerido', 'GET', '/api/v1/quotes');
  await expect(401, 'JWT inválido', 'GET', '/api/v1/quotes', 'INVALID');
  await setup();
  const [a,b] = await Promise.all(fixture.entities.map(token));
  const [aa,bb] = fixture.entities;
  await expect(200, 'Identidad A', 'GET', '/api/v1/auth/me', a);
  await expect(200, 'Identidad B', 'GET', '/api/v1/auth/me', b);
  await expect(200, 'Lista inicial A', 'GET', '/api/v1/quotes', a);
  await expect(200, 'Lista inicial B', 'GET', '/api/v1/quotes', b);
  await expect(400, 'Rechazar empresa_id inyectada', 'POST', '/api/v1/quotes', a,
    { sucursal_id: aa.branch, folio: `${prefix}_INJECT`, empresa_id: bb.company, detalles: [{producto_id:aa.product,cantidad:'1'}] });
  await expect(404, 'Rechazar sucursal extranjera', 'POST', '/api/v1/quotes', a,
    { sucursal_id: bb.branch, folio: `${prefix}_FOREIGN`, detalles: [{producto_id:aa.product,cantidad:'1'}] });
  await expect(422, 'Rechazar producto de otra empresa', 'POST', '/api/v1/quotes', a,
    { sucursal_id: aa.branch, folio: `${prefix}_BADPRODUCT`, detalles: [{producto_id:bb.product,cantidad:'1'}] });
  const body = { sucursal_id: aa.branch, cliente_id: aa.customer,
    folio: `${prefix}_MAIN`, detalles: [{ producto_id: aa.product, cantidad: '2.000', descuento_porcentaje: '10.0000' }] };
  const created = await expect(201, 'Crear cotización', 'POST', '/api/v1/quotes', a, body);
  const id = created?.data?.id;
  assert.ok(/^\d+$/.test(id));
  assert.equal(created.data.estado, 'BORRADOR');
  assert.equal(Number(created.data.total), 208.80, 'Subtotal 200, descuento 20, impuesto 28.80');
  ok('Trigger de impuestos y totales vía HTTP');
  await expect(409, 'Folio duplicado', 'POST', '/api/v1/quotes', a, body);
  await expect(404, 'Cotización de empresa ajena invisible', 'GET', `/api/v1/quotes/${id}`, b);
  await expect(400, 'ID fuera de BIGINT', 'GET', '/api/v1/quotes/9223372036854775808', a);
  await expect(400, 'Filtro empresa_id rechazado', 'GET', '/api/v1/quotes?empresa_id=1', a);
  await expect(200, 'Obtener detalle propio', 'GET', `/api/v1/quotes/${id}`, a);
  await expect(200, 'Filtrado por estado BORRADOR', 'GET', '/api/v1/quotes?estado=BORRADOR', a);
  const edited = await expect(200, 'Editar borrador', 'PATCH', `/api/v1/quotes/${id}`, a,
    { observaciones: 'Revisada', detalles: [{ producto_id: aa.product, cantidad:'3', descuento_porcentaje:'10' }] });
  assert.equal(Number(edited.data.total), 313.20); ok('Total recalculado por trigger tras PATCH');
  await expect(400, 'Folio inmutable', 'PATCH', `/api/v1/quotes/${id}`, a, {folio:'ALTERADO'});
  await expect(200, 'Enviar cotización', 'POST', `/api/v1/quotes/${id}/send`, a, {});
  await expect(409, 'Impedir edición tras envío', 'PATCH', `/api/v1/quotes/${id}`, a, {observaciones:'INVALIDO'});
  await expect(200, 'Aceptar cotización', 'POST', `/api/v1/quotes/${id}/accept`, a, {});
  await expect(409, 'Impedir cancelar aceptada', 'POST', `/api/v1/quotes/${id}/cancel`, a, {});
  const counts = (await db.query(`SELECT
    (SELECT count(*) FROM pos.venta WHERE empresa_id=ANY($1::bigint[]))::int AS ventas,
    (SELECT count(*) FROM pos.movimiento_inventario m JOIN pos.almacen w ON w.id=m.almacen_id JOIN pos.sucursal b ON b.id=w.sucursal_id WHERE b.empresa_id=ANY($1::bigint[]))::int AS movimientos,
    (SELECT count(*) FROM pos.sincronizacion_ecommerce_inventario o JOIN pos.movimiento_inventario m ON m.id=o.movimiento_inventario_id JOIN pos.almacen w ON w.id=m.almacen_id JOIN pos.sucursal b ON b.id=w.sucursal_id WHERE b.empresa_id=ANY($1::bigint[]))::int AS outbox`, [fixture.companies])).rows[0];
  assert.deepEqual(counts, {ventas:0,movimientos:0,outbox:0}); ok('Cotizar no crea ventas, inventario ni outbox');
  console.log(`[OK] ${checks} verificaciones; iniciando limpieza.`);
} catch (error) {
  console.error('[ERROR QUOTE HTTP]', error);
  process.exitCode = 1;
} finally {
  if (connected) {
    if (tx) await db.query('ROLLBACK').catch(() => {});
    try { await cleanup(); }
    catch (error) { console.error('[ERROR LIMPIEZA]', error); process.exitCode = 1; }
    await db.end().catch(() => {});
  }
  console.log(`CODIGO FINAL: ${process.exitCode || 0}`);
}
