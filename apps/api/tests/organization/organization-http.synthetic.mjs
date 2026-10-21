/** End-to-end organization API JWT synthetic credentials against local dev only. No existing tenant touched. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { hash } from 'bcryptjs';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
assert.ok(connectionString, 'DATABASE_URL no configurado.');
const dbURL = new URL(connectionString);
assert.ok(['postgres:', 'postgresql:'].includes(dbURL.protocol) &&
  ['localhost', '127.0.0.1'].includes(dbURL.hostname) &&
  (!dbURL.port || dbURL.port === '5432') && dbURL.pathname === '/pos_novnix',
  'BD autorizada exclusivamente pos_novnix local.');
const baseURL = new URL(process.env.POS_HTTP_URL || 'http://127.0.0.1:3000');
assert.ok(baseURL.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(baseURL.hostname),
  'API debe ejecutarse en localhost (HTTP).');
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const marker = `ORG_HTTP_${suffix}`;
const roleCode = `OHTTP_${suffix}`;
const password = randomBytes(24).toString('base64url');
const db = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
let fixture = null, openTx = false, connected = false, checks = 0;
const ok = (msg) => { checks++; console.log(`[OK] ${msg}`); };

async function http(method, path, token, body) {
  const response = await fetch(new URL(path, baseURL), {
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
async function expect(status, description, method, path, token, body) {
  const result = await http(method, path, token, body);
  assert.equal(result.status, status,
    `${description}: HTTP ${result.status}; esperado ${status}; mensaje=${result.json?.message ?? '<sin mensaje>'}`);
  ok(`${description}: HTTP ${status}`);
  return result.json;
}
async function login(user) {
  const login = await expect(200, `Login ${user.label}`, 'POST', '/api/v1/auth/login', null,
    { empresa_id: user.companyId, username: user.username, password });
  const jwt = login?.data?.access_token;
  assert.ok(typeof jwt === 'string' && jwt.length > 20, 'Login no devolvió JWT válido.');
  const profile = await expect(200, `Identidad ${user.label}`, 'GET', '/api/v1/auth/me', jwt);
  assert.equal(String(profile?.data?.empresa?.id), user.companyId);
  return jwt;
}
async function cleanup() {
  if (!fixture) return;
  await db.query('BEGIN'); openTx = true;
  try {
    const companies = await db.query(`SELECT id, razon_social FROM pos.empresa
      WHERE id = ANY($1::bigint[]) FOR UPDATE`, [fixture.companyIds]);
    assert.equal(companies.rows.length, 2, 'Empresa sintética faltante; limpieza detenida.');
    for (const x of companies.rows) {
      assert.ok(x.razon_social === marker || x.razon_social === `${marker}_EXTERNA`, 'Empresa ajena: limpieza detenida.');
    }
    const roles = await db.query('SELECT codigo FROM pos.rol WHERE id = $1', [fixture.roleId]);
    assert.equal(roles.rows[0]?.codigo, roleCode, 'Rol no sintético: limpieza detenida.');
    const users = await db.query(`SELECT id, username, empresa_id FROM pos.usuario
      WHERE empresa_id = ANY($1::bigint[])`, [fixture.companyIds]);
    assert.equal(users.rows.length, fixture.userIds.length, 'Usuarios inesperados: limpieza detenida.');
    assert.ok(users.rows.every(u => u.username.startsWith(`ohttp_${suffix}_`)), 'Usuario ajeno detectado.');
    const branches = await db.query(`SELECT id, codigo FROM pos.sucursal
      WHERE empresa_id = ANY($1::bigint[])`, [fixture.companyIds]);
    assert.ok(branches.rows.every(x => x.codigo.toUpperCase().startsWith(`O${suffix.toUpperCase()}`)), 'Sucursal ajena: limpieza detenida.');
    const warehouseRows = await db.query(`SELECT w.id, w.codigo FROM pos.almacen w
      JOIN pos.sucursal b ON b.id = w.sucursal_id WHERE b.empresa_id = ANY($1::bigint[])`, [fixture.companyIds]);
    assert.ok(warehouseRows.rows.every(x => x.codigo.toUpperCase().startsWith(`O${suffix.toUpperCase()}`)), 'Almacén ajeno: limpieza detenida.');
    for (const table of ['compra', 'venta', 'transferencia_almacen', 'producto', 'proveedor']) {
      const count = await db.query(`SELECT count(*)::int AS n FROM pos.${table} WHERE empresa_id=ANY($1::bigint[])`, [fixture.companyIds]);
      assert.equal(count.rows[0].n, 0, `La empresa tiene registros ${table}; limpieza detenida.`);
    }
    for (const table of ['existencia','movimiento_inventario','caja']) {
      const clause = table === 'caja' ? 'c.sucursal_id = ANY($1::bigint[])' : 'c.almacen_id = ANY($1::bigint[])';
      const sql = table === 'caja' ?
        'SELECT count(*)::int AS n FROM pos.caja c WHERE c.sucursal_id = ANY($1::bigint[])' :
        `SELECT count(*)::int AS n FROM pos.${table} c WHERE c.almacen_id = ANY($1::bigint[])`;
      const ids = table === 'caja' ? branches.rows.map(b => b.id) : warehouseRows.rows.map(w => w.id);
      const count = await db.query(sql, [ids]);
      assert.equal(count.rows[0].n, 0, `Dependencias ${table}: limpieza detenida.`);
    }
    await db.query('DELETE FROM pos.auditoria WHERE usuario_id = ANY($1::bigint[])', [fixture.userIds]);
    await db.query('DELETE FROM pos.usuario_sucursal WHERE usuario_id = ANY($1::bigint[])', [fixture.userIds]);
    await db.query('DELETE FROM pos.almacen WHERE id = ANY($1::bigint[])', [warehouseRows.rows.map(x=>x.id)]);
    await db.query('DELETE FROM pos.sucursal WHERE id = ANY($1::bigint[])', [branches.rows.map(x=>x.id)]);
    await db.query('DELETE FROM pos.usuario_rol WHERE usuario_id = ANY($1::bigint[])', [fixture.userIds]);
    await db.query('DELETE FROM pos.usuario WHERE id = ANY($1::bigint[])', [fixture.userIds]);
    await db.query('DELETE FROM pos.rol_permiso WHERE rol_id = $1', [fixture.roleId]);
    await db.query('DELETE FROM pos.rol WHERE id = $1', [fixture.roleId]);
    await db.query('DELETE FROM pos.empresa WHERE id = ANY($1::bigint[])', [fixture.companyIds]);
    await db.query('COMMIT'); openTx = false; fixture = null;
    ok('Limpieza transaccional confirmada');
  } catch(error) {
    await db.query('ROLLBACK').catch(() => {}); openTx = false;
    console.error(`[ERROR LIMPIEZA] ${marker}; empresas ${fixture.companyIds.join(',')}. No repetir sin inspección.`);
    throw error;
  }
}

try {
  await db.connect(); connected = true;
  const state = await db.query('SELECT current_database() AS nombre, inet_server_port() AS puerto');
  assert.equal(state.rows[0].nombre, 'pos_novnix'); assert.equal(state.rows[0].puerto, 5432);
  ok('PostgreSQL local confirmado');
  await expect(401, 'Protección sin JWT', 'GET', '/api/v1/organization/company');
  const permission = await db.query(`SELECT id FROM pos.permiso WHERE codigo='CONFIGURACION.GESTIONAR'`);
  assert.equal(permission.rows.length, 1, 'Permiso CONFIGURACION.GESTIONAR ausente.');
  const hashPassword = await hash(password, 10);
  await db.query('BEGIN'); openTx = true;
  let prepared;
  try {
    const companyA = String((await db.query(
      'INSERT INTO pos.empresa(razon_social,nombre_comercial) VALUES ($1,$1) RETURNING id', [marker])).rows[0].id);
    const companyB = String((await db.query(
      'INSERT INTO pos.empresa(razon_social,nombre_comercial) VALUES ($1,$1) RETURNING id', [`${marker}_EXTERNA`])).rows[0].id);
    const foreignBranch = String((await db.query(
      'INSERT INTO pos.sucursal(empresa_id,codigo,nombre) VALUES ($1,$2,$3) RETURNING id',
      [companyB, `O${suffix}FOREIGN`, 'Sucursal externa sintética'])).rows[0].id);
    const roleId = String((await db.query(
      'INSERT INTO pos.rol(codigo,nombre) VALUES ($1,$2) RETURNING id', [roleCode, 'Administración Organización sintética'])).rows[0].id);
    await db.query('INSERT INTO pos.rol_permiso(rol_id,permiso_id) VALUES ($1,$2)', [roleId, permission.rows[0].id]);
    const users = [];
    for (const [label, companyId] of [['admin', companyA], ['sin_permiso', companyA], ['operador', companyA], ['externo', companyB]]) {
      const username = `ohttp_${suffix}_${label}`;
      const userId = String((await db.query(
        'INSERT INTO pos.usuario(empresa_id,username,password_hash,nombre) VALUES ($1,$2,$3,$4) RETURNING id',
        [companyId, username, hashPassword, 'Prueba Organización'])).rows[0].id);
      users.push({ id:userId, username, companyId, label });
    }
    await db.query('INSERT INTO pos.usuario_rol(usuario_id,rol_id) VALUES ($1,$2)', [users[0].id, roleId]);
    prepared = { companyIds:[companyA, companyB], roleId, userIds:users.map(x=>x.id), users, foreignBranch };
    await db.query('COMMIT'); openTx = false;
    fixture = prepared;
    ok(`Fixture sintético confirmado: ${marker}`);
  } catch(error) { await db.query('ROLLBACK').catch(()=>{}); openTx = false; throw error; }

  const admin = await login(fixture.users[0]);
  const noPermission = await login(fixture.users[1]);
  await expect(401, 'JWT inválido', 'GET', '/api/v1/organization/company', 'jwt-invalido');
  await expect(403, 'Permiso requerido', 'GET', '/api/v1/organization/company', noPermission);
  await expect(200, 'Consultar empresa propia', 'GET', '/api/v1/organization/company', admin);
  await expect(400, 'No se permite desactivar empresa propia', 'PATCH', '/api/v1/organization/company', admin, { activo:false });
  await expect(200, 'Actualizar empresa propia', 'PATCH', '/api/v1/organization/company', admin, { telefono:'5555001111' });
  await expect(400, 'Empresa_id inyectado rechazado', 'POST', '/api/v1/organization/branches', admin,
    { empresa_id:fixture.companyIds[1], codigo:`O${suffix}B1`, nombre:'Nueva' });
  const b = await expect(201, 'Crear sucursal', 'POST', '/api/v1/organization/branches', admin,
    { codigo:`O${suffix}B1`, nombre:'Sucursal principal' });
  const branchId = String(b?.data?.id); assert.ok(/^\d+$/.test(branchId));
  await expect(409, 'Duplicado sucursal', 'POST', '/api/v1/organization/branches', admin,
    { codigo:`o${suffix}b1`, nombre:'Duplicado' });
  await expect(404, 'Sucursal de empresa externa no visible', 'GET', `/api/v1/organization/branches/${fixture.foreignBranch}`, admin);
  await expect(400, 'ID inválido', 'GET', '/api/v1/organization/branches/invalido', admin);
  const w = await expect(201, 'Crear almacén', 'POST', '/api/v1/organization/warehouses', admin,
    { sucursal_id:branchId, codigo:`O${suffix}W1`, nombre:'Almacén principal' });
  const warehouseId = String(w?.data?.id); assert.ok(/^\d+$/.test(warehouseId));
  await expect(409, 'Duplicado almacén', 'POST', '/api/v1/organization/warehouses', admin,
    { sucursal_id:branchId, codigo:`o${suffix}w1`, nombre:'Almacén repetido' });
  await expect(404, 'Crear almacén externo rechazado', 'POST', '/api/v1/organization/warehouses', admin,
    { sucursal_id:fixture.foreignBranch, codigo:`O${suffix}WX`, nombre:'Inválido' });
  await expect(409, 'No desactivar sucursal con almacén activo', 'PATCH', `/api/v1/organization/branches/${branchId}`, admin,
    { activo:false });
  await expect(404, 'No asignar usuario de otra empresa', 'POST', `/api/v1/organization/branches/${branchId}/users`, admin,
    { usuario_id:fixture.users[3].id });
  const assignment = await expect(201, 'Asignación de usuario propia', 'POST', `/api/v1/organization/branches/${branchId}/users`, admin,
    { usuario_id:fixture.users[2].id, es_predeterminada:true });
  assert.equal(assignment?.data?.es_predeterminada, true);
  await expect(200, 'Lista de usuarios por sucursal', 'GET', `/api/v1/organization/branches/${branchId}/users`, admin);
  await expect(200, 'Desactivar almacén libre', 'PATCH', `/api/v1/organization/warehouses/${warehouseId}`, admin,
    { activo:false });
  await expect(409, 'No desactivar sucursal con usuarios', 'PATCH', `/api/v1/organization/branches/${branchId}`, admin,
    { activo:false });
  await expect(200, 'Quitar asignación', 'DELETE', `/api/v1/organization/branches/${branchId}/users/${fixture.users[2].id}`, admin);
  await expect(200, 'Desactivar sucursal libre', 'PATCH', `/api/v1/organization/branches/${branchId}`, admin,
    { activo:false });
  await expect(409, 'No crear almacén en sucursal inactiva', 'POST', '/api/v1/organization/warehouses', admin,
    { sucursal_id:branchId, codigo:`O${suffix}W2`, nombre:'Bodega segunda' });
  await expect(200, 'Reactivar sucursal', 'PATCH', `/api/v1/organization/branches/${branchId}`, admin,
    { activo:true });
  await expect(200, 'Reactivar almacén', 'PATCH', `/api/v1/organization/warehouses/${warehouseId}`, admin,
    { activo:true });
  await expect(200, 'Listado de sucursales', 'GET', '/api/v1/organization/branches', admin);
  await expect(200, 'Listado de almacenes', 'GET', '/api/v1/organization/warehouses', admin);
  console.log(`[OK] ${checks} verificaciones HTTP/BD. Iniciando limpieza.`);
} catch(error) {
  process.exitCode = 1;
  console.error('[ERROR ORGANIZATION HTTP]', error);
} finally {
  if(connected) {
    if(openTx) await db.query('ROLLBACK').catch(()=>{});
    try { await cleanup(); } catch(e) { process.exitCode = 1; console.error('[ERROR LIMPIEZA]',e); }
    await db.end().catch(()=>{});
  }
  console.log(`CODIGO FINAL: ${process.exitCode || 0}`);
}
