/**
 * POSMYCLETH - prueba HTTP de Compras sin credenciales previas.
 * Genera dos identidades sintéticas, valida login JWT/permisos/GET y limpia.
 * No crea ni altera documentos de compra.
 * Ejecutar dentro de apps/api con la API local ya iniciada.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { hash } from 'bcryptjs';

const connectionString = process.env.DATABASE_URL;
assert.ok(connectionString, 'DATABASE_URL no configurada en apps/api/.env');
const dbURL = new URL(connectionString);
assert.ok(
  ['postgres:', 'postgresql:'].includes(dbURL.protocol) &&
  ['localhost', '127.0.0.1'].includes(dbURL.hostname) &&
  (!dbURL.port || dbURL.port === '5432') &&
  dbURL.pathname === '/pos_novnix',
  'ABORTADO: solo se permite PostgreSQL local pos_novnix:5432.'
);

const baseURL = new URL(process.env.POS_HTTP_URL || 'http://127.0.0.1:3000');
assert.ok(baseURL.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(baseURL.hostname),
  'ABORTADO: solo se permiten API HTTP locales.');

const db = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const marker = `PURCHASE_HTTP_TEST_${suffix}`;
const roleCode = `PHTTP_${suffix}`;
const password = randomBytes(24).toString('base64url');
let fixture;
let inTransaction = false;
let connected = false;
let checks = 0;

function ok(name) { checks += 1; console.log(`[OK] ${name}`); }

async function http(method, path, token, body) {
  const target = new URL(path, baseURL);
  const response = await fetch(target, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function expectHttp(expected, label, method, path, token, body) {
  const result = await http(method, path, token, body);
  assert.equal(result.status, expected,
    `${label}: HTTP ${result.status}; se esperaba ${expected}. Respuesta: ${JSON.stringify(result.json)}`);
  ok(`${label}: HTTP ${expected}`);
  return result.json;
}

async function login(user) {
  const result = await expectHttp(200, `Inicio de sesion ${user.label}`,
    'POST', '/api/v1/auth/login', null,
    { empresa_id: fixture.companyId, username: user.username, password });
  const token = result?.data?.access_token;
  assert.ok(typeof token === 'string' && token.length > 20, `JWT no recibido para ${user.label}`);
  const me = await expectHttp(200, `Identidad ${user.label}`,
    'GET', '/api/v1/auth/me', token);
  assert.equal(String(me?.data?.id), user.id, 'El JWT no pertenece al usuario creado.');
  assert.equal(String(me?.data?.empresa?.id), fixture.companyId, 'El JWT no pertenece a la empresa de prueba.');
  return token;
}

async function cleanup() {
  if (!fixture) return;
  await db.query('BEGIN');
  inTransaction = true;
  try {
    const company = await db.query(
      'SELECT razon_social, nombre_comercial FROM pos.empresa WHERE id = $1 FOR UPDATE',
      [fixture.companyId]);
    assert.equal(company.rows.length, 1, 'Empresa sintética no encontrada al limpiar.');
    assert.equal(company.rows[0].razon_social, marker, 'Protección de limpieza: empresa distinta.');
    assert.equal(company.rows[0].nombre_comercial, marker, 'Protección de limpieza: empresa distinta.');

    const role = await db.query('SELECT codigo FROM pos.rol WHERE id = $1', [fixture.roleId]);
    assert.equal(role.rows[0]?.codigo, roleCode, 'Protección de limpieza: rol distinto.');

    const userRows = await db.query(
      'SELECT id, username, empresa_id FROM pos.usuario WHERE id = ANY($1::bigint[])',
      [fixture.userIds]);
    assert.equal(userRows.rows.length, 2, 'Protección de limpieza: usuarios no encontrados.');
    for (const item of userRows.rows) {
      assert.equal(String(item.empresa_id), fixture.companyId, 'Protección de limpieza: usuario ajeno.');
      assert.ok(item.username.startsWith(`phttp_${suffix}_`), 'Protección de limpieza: usuario no sintético.');
    }

    const purchaseCount = await db.query('SELECT count(*)::int AS n FROM pos.compra WHERE empresa_id = $1', [fixture.companyId]);
    assert.equal(purchaseCount.rows[0].n, 0, 'No se elimina la empresa: contiene compras.');

    await db.query('DELETE FROM pos.auditoria WHERE usuario_id = ANY($1::bigint[])', [fixture.userIds]);
    await db.query('DELETE FROM pos.usuario_rol WHERE usuario_id = ANY($1::bigint[])', [fixture.userIds]);
    await db.query('DELETE FROM pos.usuario WHERE id = ANY($1::bigint[])', [fixture.userIds]);
    await db.query('DELETE FROM pos.rol_permiso WHERE rol_id = $1', [fixture.roleId]);
    await db.query('DELETE FROM pos.rol WHERE id = $1', [fixture.roleId]);
    await db.query('DELETE FROM pos.empresa WHERE id = $1', [fixture.companyId]);
    await db.query('COMMIT');
    inTransaction = false;
    fixture = undefined;
    ok('Limpieza de empresa, usuarios, rol y permisos sintéticos confirmada');
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { /* Conexión posiblemente cerrada. */ }
    inTransaction = false;
    console.error(`[ATENCION] Limpieza incompleta de ${marker}, empresa ID ${fixture.companyId}; no repetir sin inspeccionarla.`);
    throw error;
  }
}

try {
  await db.connect();
  connected = true;
  const current = await db.query('SELECT current_database() AS nombre, inet_server_port() AS puerto');
  assert.equal(current.rows[0]?.nombre, 'pos_novnix', 'Base de datos distinta a pos_novnix.');
  assert.equal(current.rows[0]?.puerto, 5432, 'Puerto PostgreSQL distinto de 5432.');
  ok('Base de desarrollo pos_novnix:5432 verificada');

  const perm = await db.query('SELECT id FROM pos.permiso WHERE codigo = $1', ['COMPRAS.VER']);
  assert.equal(perm.rows.length, 1, 'No existe permiso COMPRAS.VER.');

  // Verificar conectividad de la API ANTES de crear registros.
  const health = await fetch(new URL('/api/v1/purchases', baseURL), { signal: AbortSignal.timeout(10000) });
  assert.equal(health.status, 401,
    `La API no exige autenticación en Compras (HTTP ${health.status}). Revisa el servidor activo.`);
  ok('API local responde y exige autenticación');

  const passwordHash = await hash(password, 10);
  await db.query('BEGIN');
  inTransaction = true;
  try {
    const company = await db.query(
      'INSERT INTO pos.empresa (razon_social, nombre_comercial) VALUES ($1, $1) RETURNING id',
      [marker]);
    const companyId = String(company.rows[0].id);
    const role = await db.query(
      'INSERT INTO pos.rol (codigo, nombre) VALUES ($1, $2) RETURNING id',
      [roleCode, 'Lectura de Compras HTTP - temporal']);
    const roleId = String(role.rows[0].id);
    await db.query('INSERT INTO pos.rol_permiso (rol_id, permiso_id) VALUES ($1, $2)',
      [roleId, perm.rows[0].id]);

    const users = [];
    for (const label of ['lector', 'sin_permiso']) {
      const username = `phttp_${suffix}_${label}`;
      const result = await db.query(
        'INSERT INTO pos.usuario (empresa_id, username, password_hash, nombre) VALUES ($1, $2, $3, $4) RETURNING id',
        [companyId, username, passwordHash, 'Usuario HTTP sintético']);
      users.push({ id: String(result.rows[0].id), username, label });
    }
    await db.query('INSERT INTO pos.usuario_rol (usuario_id, rol_id) VALUES ($1, $2)',
      [users[0].id, roleId]);
    await db.query('COMMIT');
    inTransaction = false;
    fixture = { companyId, roleId, userIds: users.map((u) => u.id), users };
    console.log(`[TEMPORAL] Marca: ${marker}; empresa ID: ${companyId}`);
    ok('Empresa, rol y dos usuarios sintéticos creados');
  } catch (error) {
    await db.query('ROLLBACK');
    inTransaction = false;
    throw error;
  }

  const readerToken = await login(fixture.users[0]);
  const blockedToken = await login(fixture.users[1]);

  await expectHttp(401, 'Listado sin JWT', 'GET', '/api/v1/purchases');
  await expectHttp(401, 'Listado con JWT invalido', 'GET', '/api/v1/purchases', 'jwt-no-valido');
  await expectHttp(403, 'Usuario sin permiso COMPRAS.VER', 'GET', '/api/v1/purchases', blockedToken);
  const list = await expectHttp(200, 'Listado con JWT autorizado', 'GET', '/api/v1/purchases', readerToken);
  assert.equal(list?.ok, true);
  assert.ok(Array.isArray(list?.data?.items), 'La respuesta no contiene lista de compras.');
  assert.equal(list.data.items.length, 0, 'La empresa sintética no debe tener compras.');
  ok('Listado aislado de la empresa sintética: cero compras');
  await expectHttp(400, 'ID invalido de compra', 'GET', '/api/v1/purchases/invalido', readerToken);
  await expectHttp(404, 'Compra inexistente', 'GET', '/api/v1/purchases/9223372036854775807', readerToken);
  console.log(`[OK] Pruebas HTTP iniciales completadas: ${checks} verificaciones.`);
} catch (error) {
  process.exitCode = 1;
  console.error('[ERROR]', error instanceof Error ? error.message : String(error));
} finally {
  if (connected) {
    if (inTransaction) {
      try { await db.query('ROLLBACK'); } catch { /* conexión caída */ }
    }
    try { await cleanup(); } catch (error) {
      process.exitCode = 1;
      console.error('[ERROR LIMPIEZA]', error instanceof Error ? error.message : String(error));
    }
    await db.end();
  }
  if (process.exitCode !== 1) console.log('[OK] Codigo final: 0');
}
