/**
 * POSMYCLETH — HTTP escritura de Compras: identidades y documentos sintéticos.
 * Requiere API local, worker Ecommerce DETENIDO y pos_novnix local.
 * La limpieza se detiene si detecta registros ajenos o outbox procesada.
 * NO repetir en caso de [ERROR LIMPIEZA]; conservar la marca y revisar.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { hash } from 'bcryptjs';

const connectionString = process.env.DATABASE_URL;
assert.ok(connectionString, 'No hay DATABASE_URL en apps/api/.env');
const dbURL = new URL(connectionString);
assert.ok(['postgres:', 'postgresql:'].includes(dbURL.protocol) &&
  ['localhost', '127.0.0.1'].includes(dbURL.hostname) &&
  (!dbURL.port || dbURL.port === '5432') && dbURL.pathname === '/pos_novnix',
  'ABORTADO: solo pos_novnix local:5432.');
const baseURL = new URL(process.env.POS_HTTP_URL || 'http://127.0.0.1:3000');
assert.ok(baseURL.protocol === 'http:' &&
  ['localhost', '127.0.0.1'].includes(baseURL.hostname) &&
  (!baseURL.port || baseURL.port === '3000'), 'ABORTADO: solo API local puerto 3000.');

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const marker = `PURCHASE_HTTP_WRITE_${suffix}`;
const roleCode = `PHW_${suffix}`;
const password = randomBytes(24).toString('base64url');
const db = new pg.Client({ connectionString, connectionTimeoutMillis: 7000 });
let fixture;
let connected = false;
let inTransaction = false;
let count = 0;
let abortRequested = false;

process.on('SIGINT', () => {
  abortRequested = true;
  console.error('[ATENCION] Interrupcion recibida. Esperando limpieza automatica; no cierres esta terminal.');
  process.exitCode = 130;
});
function checkInterrupt() {
  if (abortRequested) throw new Error('Prueba interrumpida por el usuario');
}
function ok(label) { count += 1; console.log(`[OK] ${label}`); }
async function sql(text, params = []) { return db.query(text, params); }
async function insert(text, params) {
  const result = await sql(text, params);
  assert.equal(result.rows.length, 1);
  return String(result.rows[0].id);
}
async function http(method, pathname, token, body, key) {
  checkInterrupt();
  const response = await fetch(new URL(pathname, baseURL), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25000),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}
async function expect(expected, label, method, path, token, body, key) {
  const result = await http(method, path, token, body, key);
  assert.equal(result.status, expected, `${label}: esperado HTTP ${expected}, recibido ${result.status}; ` +
    `respuesta=${JSON.stringify(result.data)}`);
  ok(`${label}: HTTP ${expected}`);
  return result.data;
}
async function login(user) {
  const reply = await expect(200, `Login ${user.label}`, 'POST', '/api/v1/auth/login', null,
    { empresa_id: fixture.companyId, username: user.username, password });
  const token = reply?.data?.access_token;
  assert.ok(typeof token === 'string' && token.length > 20, 'El login no devolvio JWT');
  const me = await expect(200, `Identidad ${user.label}`, 'GET', '/api/v1/auth/me', token);
  assert.equal(String(me?.data?.id), user.id);
  assert.equal(String(me?.data?.empresa?.id), fixture.companyId);
  return token;
}
async function createFixture() {
  const permissionRows = await sql(
    "SELECT id,codigo FROM pos.permiso WHERE codigo = ANY($1::text[])",
    [['COMPRAS.VER', 'COMPRAS.CREAR', 'COMPRAS.CANCELAR']]);
  assert.equal(permissionRows.rows.length, 3, 'Faltan permisos COMPRAS.VER/CREAR/CANCELAR');
  const passwordHash = await hash(password, 10);
  await sql('BEGIN');
  inTransaction = true;
  try {
    const companyId = await insert(
      'INSERT INTO pos.empresa (razon_social,nombre_comercial) VALUES ($1,$1) RETURNING id', [marker]);
    const branchId = await insert(
      'INSERT INTO pos.sucursal (empresa_id,codigo,nombre) VALUES ($1,$2,$3) RETURNING id',
      [companyId, 'PRUEBAS', 'Sucursal sintetica']);
    const warehouseId = await insert(
      'INSERT INTO pos.almacen (sucursal_id,codigo,nombre) VALUES ($1,$2,$3) RETURNING id',
      [branchId, 'ALM', 'Almacen sintetico']);
    const supplierId = await insert(
      'INSERT INTO pos.proveedor (empresa_id,codigo,razon_social) VALUES ($1,$2,$3) RETURNING id',
      [companyId, `PV-${suffix}`, 'Proveedor sintetico']);
    const unitId = await insert(
      'INSERT INTO pos.unidad_medida (codigo,nombre) VALUES ($1,$2) RETURNING id',
      [`PW${suffix}`, 'Unidad sintetica']);
    const productId = await insert(
      'INSERT INTO pos.producto (empresa_id,unidad_medida_id,sku,codigo_barras,nombre,controla_inventario) VALUES ($1,$2,$3,$4,$5,true) RETURNING id',
      [companyId, unitId, `PW-${suffix}`, `PW-BAR-${suffix}`, 'Producto sintetico']);
    const methodId = await insert(
      'INSERT INTO pos.metodo_pago (codigo,nombre,es_efectivo) VALUES ($1,$2,false) RETURNING id',
      [`PW${suffix}`, 'Metodo sintetico']);
    const cashMethodId = await insert(
      'INSERT INTO pos.metodo_pago (codigo,nombre,es_efectivo) VALUES ($1,$2,true) RETURNING id',
      [`PWC${suffix}`, 'Efectivo sintetico']);
    const roleId = await insert(
      'INSERT INTO pos.rol (codigo,nombre) VALUES ($1,$2) RETURNING id',
      [roleCode, 'Compras HTTP escritura - temporal']);
    for (const row of permissionRows.rows) {
      await sql('INSERT INTO pos.rol_permiso (rol_id,permiso_id) VALUES ($1,$2)',
        [roleId, row.id]);
    }
    const users = [];
    for (const label of ['operador', 'sin_permiso']) {
      const username = `pwh_${suffix}_${label}`;
      const id = await insert(
        'INSERT INTO pos.usuario (empresa_id,username,nombre,password_hash) VALUES ($1,$2,$3,$4) RETURNING id',
        [companyId, username, 'Usuario sintetico Compras', passwordHash]);
      users.push({ id, username, label });
    }
    await sql('INSERT INTO pos.usuario_rol (usuario_id,rol_id) VALUES ($1,$2)', [users[0].id, roleId]);
    await sql('INSERT INTO pos.usuario_sucursal (usuario_id,sucursal_id) VALUES ($1,$2)',
      [users[0].id, branchId]);
    const cashId = await insert(
      'INSERT INTO pos.caja (sucursal_id,codigo,nombre) VALUES ($1,$2,$3) RETURNING id',
      [branchId, 'CAJA', 'Caja sintetica']);
    const sessionId = await insert(
      'INSERT INTO pos.sesion_caja (caja_id,usuario_apertura_id,monto_apertura) VALUES ($1,$2,$3) RETURNING id',
      [cashId, users[0].id, '500.00']);

    await sql('COMMIT');
    inTransaction = false;
    fixture = { companyId, branchId, warehouseId, supplierId, unitId, productId,
      methodId, cashMethodId, roleId, users, cashId, sessionId };
    console.log(`[TEMPORAL] Empresa ${companyId}; marca ${marker}`);
    ok('Fixture sintetico confirmado');
  } catch (error) {
    await sql('ROLLBACK').catch(() => {});
    inTransaction = false;
    throw error;
  }
}
async function cleanup() {
  if (!fixture) return;
  const f = fixture;
  await sql('BEGIN');
  inTransaction = true;
  try {
    const company = await sql('SELECT razon_social,nombre_comercial FROM pos.empresa WHERE id=$1 FOR UPDATE', [f.companyId]);
    assert.equal(company.rows[0]?.razon_social, marker, 'Proteccion: empresa no sintetica');
    assert.equal(company.rows[0]?.nombre_comercial, marker, 'Proteccion: empresa no sintetica');
    const role = await sql('SELECT codigo FROM pos.rol WHERE id=$1', [f.roleId]);
    assert.equal(role.rows[0]?.codigo, roleCode, 'Proteccion: rol no sintetico');
    const users = await sql('SELECT id,username FROM pos.usuario WHERE empresa_id=$1', [f.companyId]);
    assert.equal(users.rows.length, 2, 'Proteccion: numero de usuarios inesperado');
    assert.ok(users.rows.every(u => f.users.some(v => v.id === String(u.id) && v.username === u.username)),
      'Proteccion: usuarios inesperados');
    const companyPurchases = await sql('SELECT id,folio,usuario_id,sucursal_id,almacen_id,proveedor_id FROM pos.compra WHERE empresa_id=$1', [f.companyId]);
    assert.ok(companyPurchases.rows.length <= 2, 'Proteccion: hay compras adicionales');
    assert.ok(companyPurchases.rows.every(p =>
      [`P-A-${suffix}`, `P-C-${suffix}`].includes(p.folio) &&
      String(p.usuario_id) === f.users[0].id && String(p.sucursal_id) === f.branchId &&
      String(p.almacen_id) === f.warehouseId && String(p.proveedor_id) === f.supplierId),
    'Proteccion: compras no sinteticas');
    const details = await sql('SELECT d.producto_id FROM pos.compra_detalle d JOIN pos.compra c ON c.id=d.compra_id WHERE c.empresa_id=$1', [f.companyId]);
    assert.ok(details.rows.every(d => String(d.producto_id) === f.productId),
      'Proteccion: detalles con productos ajenos');
    const moves = await sql('SELECT documento_tipo,documento_id,almacen_id,usuario_id FROM pos.movimiento_inventario WHERE producto_id=$1', [f.productId]);
    const purchaseIds = new Set(companyPurchases.rows.map(p => String(p.id)));
    assert.ok(moves.rows.every(m => purchaseIds.has(String(m.documento_id)) &&
      ['COMPRA', 'CANCELACION_COMPRA'].includes(m.documento_tipo) &&
      String(m.almacen_id) === f.warehouseId && String(m.usuario_id) === f.users[0].id),
    'Proteccion: movimientos de inventario ajenos');
    const outbox = await sql(`SELECT o.estado,o.intentos,o.sincronizado_en FROM pos.sincronizacion_ecommerce_inventario o
      JOIN pos.movimiento_inventario m ON m.id=o.movimiento_inventario_id WHERE m.producto_id=$1`, [f.productId]);
    assert.ok(outbox.rows.every(o => o.estado === 'PENDIENTE' && Number(o.intentos) === 0 &&
      o.sincronizado_en === null), 'Outbox procesada: NO borrar; revisar worker Ecommerce');
    const products = await sql('SELECT sku FROM pos.producto WHERE empresa_id=$1', [f.companyId]);
    assert.equal(products.rows.length, 1, 'Proteccion: productos adicionales');
    assert.equal(products.rows[0].sku, `PW-${suffix}`, 'Proteccion: producto ajeno');
    const branches = await sql('SELECT id FROM pos.sucursal WHERE empresa_id=$1', [f.companyId]);
    assert.deepEqual(branches.rows.map(r => String(r.id)), [f.branchId], 'Proteccion: sucursal ajena');
    const suppliers = await sql('SELECT id FROM pos.proveedor WHERE empresa_id=$1', [f.companyId]);
    assert.deepEqual(suppliers.rows.map(r => String(r.id)), [f.supplierId], 'Proteccion: proveedor ajeno');
    const warehouses = await sql('SELECT id FROM pos.almacen WHERE sucursal_id=$1', [f.branchId]);
    assert.deepEqual(warehouses.rows.map(r => String(r.id)), [f.warehouseId], 'Proteccion: almacen ajeno');
    const units = await sql('SELECT codigo FROM pos.unidad_medida WHERE id=$1', [f.unitId]);
    assert.equal(units.rows[0]?.codigo, `PW${suffix}`, 'Proteccion: unidad ajena');
    const methods = await sql('SELECT id,codigo FROM pos.metodo_pago WHERE id=ANY($1::bigint[])', [[f.methodId, f.cashMethodId]]);
    assert.equal(methods.rows.length, 2, 'Proteccion: metodos faltantes');
    assert.ok(methods.rows.every(m => [`PW${suffix}`, `PWC${suffix}`].includes(m.codigo)),
      'Proteccion: metodos de pago ajenos');
    const pays = await sql('SELECT p.metodo_pago_id,p.compra_id FROM pos.compra_pago p JOIN pos.compra c ON c.id=p.compra_id WHERE c.empresa_id=$1', [f.companyId]);
    assert.ok(pays.rows.every(p => [f.methodId, f.cashMethodId].includes(String(p.metodo_pago_id)) &&
      purchaseIds.has(String(p.compra_id))), 'Proteccion: pagos ajenos');
    const cashMoves = await sql('SELECT sesion_caja_id,referencia FROM pos.movimiento_caja WHERE usuario_id=$1', [f.users[0].id]);
    assert.ok(cashMoves.rows.every(m => String(m.sesion_caja_id) === f.sessionId &&
      String(m.referencia).startsWith('COMPRA:')), 'Proteccion: movimientos de caja ajenos');

    const userIds = f.users.map(u => u.id);
    await sql('DELETE FROM pos.auditoria WHERE usuario_id=ANY($1::bigint[])', [userIds]);
    await sql(`DELETE FROM pos.sincronizacion_ecommerce_inventario WHERE movimiento_inventario_id IN
      (SELECT id FROM pos.movimiento_inventario WHERE producto_id=$1)`, [f.productId]);
    await sql('DELETE FROM pos.operacion_compra WHERE empresa_id=$1', [f.companyId]);
    await sql(`DELETE FROM pos.compra_pago WHERE compra_id IN
      (SELECT id FROM pos.compra WHERE empresa_id=$1)`, [f.companyId]);
    await sql('DELETE FROM pos.movimiento_caja WHERE usuario_id=$1', [f.users[0].id]);
    await sql('DELETE FROM pos.movimiento_inventario WHERE producto_id=$1', [f.productId]);
    await sql("UPDATE pos.compra SET estado='BORRADOR' WHERE empresa_id=$1 AND estado IN ('RECIBIDA','CANCELADA')", [f.companyId]);
    await sql(`DELETE FROM pos.compra_detalle WHERE compra_id IN
      (SELECT id FROM pos.compra WHERE empresa_id=$1)`, [f.companyId]);
    await sql('DELETE FROM pos.compra WHERE empresa_id=$1', [f.companyId]);
    await sql('DELETE FROM pos.existencia WHERE producto_id=$1', [f.productId]);
    await sql('DELETE FROM pos.sesion_caja WHERE id=$1', [f.sessionId]);
    await sql('DELETE FROM pos.caja WHERE id=$1', [f.cashId]);
    await sql('DELETE FROM pos.producto WHERE id=$1', [f.productId]);
    await sql('DELETE FROM pos.proveedor WHERE id=$1', [f.supplierId]);
    await sql('DELETE FROM pos.almacen WHERE id=$1', [f.warehouseId]);
    await sql('DELETE FROM pos.usuario_sucursal WHERE usuario_id=ANY($1::bigint[])', [userIds]);
    await sql('DELETE FROM pos.usuario_rol WHERE usuario_id=ANY($1::bigint[])', [userIds]);
    await sql('DELETE FROM pos.usuario WHERE id=ANY($1::bigint[])', [userIds]);
    await sql('DELETE FROM pos.sucursal WHERE id=$1', [f.branchId]);
    await sql('DELETE FROM pos.empresa WHERE id=$1', [f.companyId]);
    await sql('DELETE FROM pos.unidad_medida WHERE id=$1', [f.unitId]);
    await sql('DELETE FROM pos.metodo_pago WHERE id=ANY($1::bigint[])', [[f.methodId, f.cashMethodId]]);
    await sql('DELETE FROM pos.rol_permiso WHERE rol_id=$1', [f.roleId]);
    await sql('DELETE FROM pos.rol WHERE id=$1', [f.roleId]);
    const left = await sql('SELECT count(*)::int AS n FROM pos.empresa WHERE id=$1', [f.companyId]);
    assert.equal(left.rows[0].n, 0, 'Fallo limpieza empresa sintetica');
    await sql('COMMIT');
    inTransaction = false;
    fixture = undefined;
    ok('Limpieza transaccional confirmada');
  } catch (error) {
    await sql('ROLLBACK').catch(() => {});
    inTransaction = false;
    console.error(`[ERROR LIMPIEZA] Conserva marca ${marker}, empresa ${f.companyId}. NO repitas la prueba.`);
    throw error;
  }
}

try {
  await db.connect();
  connected = true;
  const info = await sql('SELECT current_database() AS nombre, inet_server_port() AS puerto');
  assert.equal(info.rows[0]?.nombre, 'pos_novnix');
  assert.equal(info.rows[0]?.puerto, 5432);
  ok('PostgreSQL local confirmado');
  const health = await http('GET', '/api/v1/purchases');
  assert.equal(health.status, 401, `API no disponible/protegida: HTTP ${health.status}`);
  ok('API local autenticada y disponible');

  await createFixture();
  const f = fixture;
  const token = await login(f.users[0]);
  const denied = await login(f.users[1]);
  const root = '/api/v1/purchases';
  const payload = folio => ({
    sucursal_id: f.branchId, almacen_id: f.warehouseId, proveedor_id: f.supplierId,
    folio, detalles: [{ producto_id: f.productId, cantidad: '2', precio_unitario: '12.5000', tasa_impuesto: '16' }],
  });
  await expect(401, 'Crear sin JWT', 'POST', root, null, payload(`P-X-${suffix}`), randomUUID());
  await expect(403, 'Crear sin permiso', 'POST', root, denied, payload(`P-X-${suffix}`), randomUUID());
  await expect(400, 'Clave idempotencia obligatoria', 'POST', root, token, payload(`P-X-${suffix}`));

  const createKey = randomUUID();
  const first = await expect(201, 'Crear compra A', 'POST', root, token, payload(`P-A-${suffix}`), createKey);
  assert.equal(first?.ok, true);
  assert.equal(first?.data?.replayed, false);
  const id = String(first?.data?.data?.id);
  assert.match(id, /^[1-9]\d*$/);
  assert.equal(first?.data?.data?.total, '29');
  const replay = await expect(201, 'Replay creacion A', 'POST', root, token, payload(`P-A-${suffix}`), createKey);
  assert.equal(replay?.data?.replayed, true);
  await expect(409, 'Conflicto clave reutilizada', 'POST', root, token, payload(`P-OTRO-${suffix}`), createKey);

  const receiveKey = randomUUID();
  const received = await expect(200, 'Recibir compra A', 'POST', `${root}/${id}/receive`, token, {}, receiveKey);
  assert.equal(received?.data?.data?.estado, 'RECIBIDA');
  assert.equal(received?.data?.replayed, false);
  const receivedAgain = await expect(200, 'Replay recepcion A', 'POST', `${root}/${id}/receive`, token, {}, receiveKey);
  assert.equal(receivedAgain?.data?.replayed, true);
  await expect(409, 'Recepcion duplicada con otra clave', 'POST', `${root}/${id}/receive`, token, {}, randomUUID());

  const paymentKey = randomUUID();
  const payment = { metodo_pago_id: f.methodId, monto: '10.00', referencia: `REF-${suffix}` };
  const paid = await expect(201, 'Pagar compra A', 'POST', `${root}/${id}/payments`, token, payment, paymentKey);
  assert.equal(paid?.data?.replayed, false);
  const paidAgain = await expect(201, 'Replay pago A', 'POST', `${root}/${id}/payments`, token, payment, paymentKey);
  assert.equal(paidAgain?.data?.replayed, true);
  await expect(409, 'Rechazar sobrepago', 'POST', `${root}/${id}/payments`, token,
    { metodo_pago_id: f.methodId, monto: '25.00' }, randomUUID());
  const cash = await expect(201, 'Pago efectivo A', 'POST', `${root}/${id}/payments`, token,
    { metodo_pago_id: f.cashMethodId, sesion_caja_id: f.sessionId, monto: '5.00' }, randomUUID());
  assert.equal(cash?.data?.replayed, false);
  await expect(409, 'Cancelar compra pagada rechazado', 'POST', `${root}/${id}/cancel`, token,
    { motivo: 'No permitida por pagos' }, randomUUID());

  const second = await expect(201, 'Crear compra C', 'POST', root, token, payload(`P-C-${suffix}`), randomUUID());
  const id2 = String(second?.data?.data?.id);
  assert.match(id2, /^[1-9]\d*$/);
  await expect(200, 'Recibir compra C', 'POST', `${root}/${id2}/receive`, token, {}, randomUUID());
  const cancelKey = randomUUID();
  const cancelled = await expect(200, 'Cancelar compra C', 'POST', `${root}/${id2}/cancel`, token,
    { motivo: 'Cancelacion sintetica HTTP' }, cancelKey);
  assert.equal(cancelled?.data?.data?.estado, 'CANCELADA');
  const cancelledAgain = await expect(200, 'Replay cancelacion C', 'POST', `${root}/${id2}/cancel`, token,
    { motivo: 'Cancelacion sintetica HTTP' }, cancelKey);
  assert.equal(cancelledAgain?.data?.replayed, true);

  const detail = await expect(200, 'Consultar compra A', 'GET', `${root}/${id}`, token);
  assert.equal(detail?.data?.resumen_financiero?.total_pagado, '15.00');
  assert.equal(detail?.data?.resumen_financiero?.saldo_pendiente, '14.00');
  const list = await expect(200, 'Listar compras creadas', 'GET', root, token);
  assert.equal(list?.data?.items?.length, 2);
  const stock = await sql('SELECT cantidad::text AS cantidad FROM pos.existencia WHERE producto_id=$1 AND almacen_id=$2',
    [f.productId, f.warehouseId]);
  assert.equal(Number(stock.rows[0]?.cantidad), 2);
  ok('Stock resultante: 2 unidades');
  const dbMoves = await sql('SELECT count(*)::int AS n FROM pos.movimiento_inventario WHERE producto_id=$1', [f.productId]);
  const outbox = await sql(`SELECT count(*)::int AS n FROM pos.sincronizacion_ecommerce_inventario o
    JOIN pos.movimiento_inventario m ON o.movimiento_inventario_id=m.id WHERE m.producto_id=$1`, [f.productId]);
  assert.equal(dbMoves.rows[0].n, 3);
  assert.equal(outbox.rows[0].n, 3);
  ok('3 movimientos y 3 eventos outbox verificados');
  console.log(`[OK] ${count} verificaciones HTTP/BD completadas`);
} catch (error) {
  process.exitCode = 1;
  console.error('[ERROR]', error instanceof Error ? error.message : String(error));
} finally {
  if (connected) {
    if (inTransaction) {
      await sql('ROLLBACK').catch(() => {});
      inTransaction = false;
    }
    try { await cleanup(); } catch (error) {
      process.exitCode = 1;
      console.error('[ERROR LIMPIEZA]', error instanceof Error ? error.message : String(error));
    }
    await db.end().catch(() => { process.exitCode = 1; });
  }
  console.log(`CODIGO FINAL: ${process.exitCode || 0}`);
}
