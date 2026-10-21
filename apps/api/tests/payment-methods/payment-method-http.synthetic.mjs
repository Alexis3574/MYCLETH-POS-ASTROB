/** JWT E2E with two isolated test companies; read-only payment endpoints; guarded transactional cleanup. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import pg from "pg";

assert.equal(process.env.POS_ALLOW_TEST_DB, "SI", "Definir POS_ALLOW_TEST_DB=SI para prueba sintética de desarrollo.");
const connectionString = process.env.DATABASE_URL;
const dbURL = new URL(connectionString || "postgres://invalid/invalid");
assert.ok(["postgres:", "postgresql:"].includes(dbURL.protocol)
  && ["localhost", "127.0.0.1"].includes(dbURL.hostname)
  && (!dbURL.port || dbURL.port === "5432") && dbURL.pathname === "/pos_novnix",
  "Base autorizada exclusivamente localhost:5432/pos_novnix.");
const endpoint = new URL(process.env.POS_HTTP_URL || "http://127.0.0.1:3000");
assert.ok(endpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname)
  && ["", "/"].includes(endpoint.pathname) && !endpoint.search && !endpoint.hash,
  "La API debe apuntar a una raíz HTTP local.");
assert.ok((process.env.JWT_SECRET || "").length >= 16, "JWT_SECRET de desarrollo requerido, sin imprimir su valor.");

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const marker = `PM_HTTP_${suffix}`;
const db = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
const secret = new TextEncoder().encode(process.env.JWT_SECRET);
let connected = false, tx = false, fixture = null, checks = 0;
function ok(label) { checks++; console.log(`[OK] ${label}`); }
function same(a, b, description) { assert.deepEqual(a, b, description); }
async function request(method, path, token) {
  const result = await fetch(new URL(path, endpoint), {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(15000),
  });
  return { status: result.status, json: await result.json().catch(() => null) };
}
async function expect(status, description, method, path, token) {
  const result = await request(method, path, token);
  assert.equal(result.status, status, `${description}: HTTP ${result.status}, esperado ${status}; ${result.json?.message || ""}`);
  ok(`${description}: HTTP ${status}`);
  return result.json;
}
async function tokenFor(user) {
  return new SignJWT({ empresa_id: user.companyId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer("pos-api")
    .setAudience("pos-web")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
}
async function catalogue() {
  return (await db.query("SELECT id::text,codigo,nombre,es_efectivo,activo FROM pos.metodo_pago ORDER BY codigo ASC,id ASC")).rows;
}
async function cleanup() {
  if (!fixture) return;
  await db.query("BEGIN"); tx = true;
  try {
    const companies = (await db.query("SELECT id::text, razon_social FROM pos.empresa WHERE id = ANY($1::bigint[]) FOR UPDATE", [fixture.companyIds])).rows;
    assert.equal(companies.length, 2, "Empresas faltantes: limpieza detenida.");
    same(companies.map(c => c.razon_social).sort(), [`${marker}_A`, `${marker}_B`].sort(), "Empresa ajena: limpieza detenida.");
    const users = (await db.query("SELECT id::text, username FROM pos.usuario WHERE empresa_id = ANY($1::bigint[])", [fixture.companyIds])).rows;
    assert.equal(users.length, 2, "Usuarios ajenos: limpieza detenida.");
    same(users.map(u => u.id).sort(), fixture.userIds.slice().sort(), "Usuarios distintos: limpieza detenida.");
    assert.ok(users.every(u => u.username.startsWith(`pm_${suffix}_`)), "Nombre inesperado de usuario.");
    for (const table of ["sucursal", "venta", "compra", "producto", "cliente", "proveedor", "cotizacion", "pedido_cliente", "orden_venta", "transferencia_almacen"]) {
      const n = (await db.query(`SELECT count(*)::int AS n FROM pos.${table} WHERE empresa_id = ANY($1::bigint[])`, [fixture.companyIds])).rows[0].n;
      assert.equal(n, 0, `Registros ${table} inesperados: limpieza detenida.`);
    }
    for (const table of ["usuario_rol", "usuario_sucursal", "auditoria"]) {
      const n = (await db.query(`SELECT count(*)::int AS n FROM pos.${table} WHERE usuario_id = ANY($1::bigint[])`, [fixture.userIds])).rows[0].n;
      assert.equal(n, 0, `Dependencias ${table} inesperadas: limpieza detenida.`);
    }
    const deletedUsers = await db.query("DELETE FROM pos.usuario WHERE id = ANY($1::bigint[])", [fixture.userIds]);
    assert.equal(deletedUsers.rowCount, 2);
    const deletedCompanies = await db.query("DELETE FROM pos.empresa WHERE id = ANY($1::bigint[])", [fixture.companyIds]);
    assert.equal(deletedCompanies.rowCount, 2);
    await db.query("COMMIT"); tx = false; fixture = null;
    ok("Limpieza transaccional confirmada: 2 usuarios y 2 empresas sintéticas");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {}); tx = false;
    console.error(`[ERROR LIMPIEZA] ${marker}; empresas ${fixture.companyIds.join(",")}. No repetir hasta inspeccionar.`);
    throw error;
  }
}

try {
  await db.connect(); connected = true;
  const context = (await db.query("SELECT current_database() AS db, inet_server_port() AS port")).rows[0];
  assert.equal(context.db, "pos_novnix"); assert.equal(context.port, 5432);
  ok("PostgreSQL de desarrollo confirmado");
  const initial = await catalogue();
  assert.ok(initial.length > 0, "El catálogo debe tener al menos un método.");
  const active = initial.filter(m => m.activo);
  ok(`Catálogo global inicial: ${initial.length} métodos, ${active.length} activos`);
  await expect(401, "JWT requerido", "GET", "/api/v1/payment-methods");
  await expect(401, "JWT inválido", "GET", "/api/v1/payment-methods", "not-a-jwt");

  await db.query("BEGIN"); tx = true;
  try {
    const users = [];
    for (const label of ["A", "B"]) {
      const companyId = String((await db.query(
        "INSERT INTO pos.empresa(razon_social,nombre_comercial) VALUES ($1,$1) RETURNING id",
        [`${marker}_${label}`])).rows[0].id);
      const username = `pm_${suffix}_${label.toLowerCase()}`;
      const id = String((await db.query(
        "INSERT INTO pos.usuario(empresa_id,username,password_hash,nombre) VALUES ($1,$2,$3,$4) RETURNING id",
        [companyId, username, "SYNTHETIC_NO_LOGIN", "Prueba de lectura pagos"])).rows[0].id);
      users.push({ id, companyId, username });
    }
    await db.query("COMMIT"); tx = false;
    fixture = { companyIds: users.map(u => u.companyId), userIds: users.map(u => u.id), users };
    ok(`Usuarios sintéticos sin roles confirmados: ${marker}`);
  } catch(error) { await db.query("ROLLBACK").catch(() => {}); tx = false; throw error; }

  const [a, b] = await Promise.all(fixture.users.map(tokenFor));
  const ownA = await expect(200, "Identidad empresa A", "GET", "/api/v1/auth/me", a);
  const ownB = await expect(200, "Identidad empresa B", "GET", "/api/v1/auth/me", b);
  assert.equal(ownA?.data?.empresa?.id, fixture.companyIds[0]);
  assert.equal(ownB?.data?.empresa?.id, fixture.companyIds[1]);
  const allA = await expect(200, "Listado global con JWT empresa A", "GET", "/api/v1/payment-methods?activo=all&pageSize=100", a);
  const allB = await expect(200, "Listado global con JWT empresa B", "GET", "/api/v1/payment-methods?activo=all&pageSize=100", b);
  same(allA?.data?.items, initial, "Listado y base de datos difieren.");
  same(allB?.data?.items, initial, "El catálogo global cambió según empresa.");
  assert.equal(allA.data.total, initial.length);
  const defaults = await expect(200, "Listado predeterminado de activos", "GET", "/api/v1/payment-methods", a);
  same(defaults.data.items, active.slice(0,25));
  assert.equal(defaults.data.total, active.length);
  const inactive = await expect(200, "Filtro inactivos", "GET", "/api/v1/payment-methods?activo=false", a);
  same(inactive.data.items, initial.filter(m => !m.activo));
  const code = await expect(200, "Filtro por código", "GET", `/api/v1/payment-methods?codigo=${encodeURIComponent(initial[0].codigo.toLowerCase())}`, a);
  assert.equal(code.data.items.length, 1);
  assert.equal(code.data.items[0].id, initial[0].id);
  const q = await expect(200, "Búsqueda por código", "GET", `/api/v1/payment-methods?q=${encodeURIComponent(initial[0].codigo.slice(0,3).toLowerCase())}`, b);
  assert.ok(q.data.items.some(m => m.id === initial[0].id));
  const p1 = await expect(200, "Paginación", "GET", "/api/v1/payment-methods?activo=all&pageSize=2&page=1", a);
  same(p1.data.items, initial.slice(0,2));
  assert.equal(p1.data.totalPages, Math.ceil(initial.length / 2));
  const detail = await expect(200, "Detalle histórico", "GET", `/api/v1/payment-methods/${initial[0].id}`, b);
  same(detail?.data, initial[0]);
  await expect(400, "ID fuera de BIGINT", "GET", "/api/v1/payment-methods/9223372036854775808", a);
  await expect(400, "ID inválido", "GET", "/api/v1/payment-methods/abc", a);
  await expect(404, "ID inexistente", "GET", "/api/v1/payment-methods/9223372036854775807", a);
  await expect(400, "Campo empresa_id rechazado", "GET", `/api/v1/payment-methods?empresa_id=${fixture.companyIds[0]}`, a);
  await expect(400, "Campo de escritura rechazado", "GET", "/api/v1/payment-methods?es_efectivo=true", b);
  await expect(400, "Estado inválido", "GET", "/api/v1/payment-methods?activo=yes", a);
  await expect(400, "Paginación fuera de rango", "GET", "/api/v1/payment-methods?pageSize=101", a);
  await expect(400, "Parámetro repetido", "GET", "/api/v1/payment-methods?activo=true&activo=false", a);
  await expect(404, "POST administrativo no existe", "POST", "/api/v1/payment-methods", a);
  same(await catalogue(), initial, "El módulo modificó pos.metodo_pago.");
  ok("Integridad: catálogo idéntico antes y después de HTTP");
  console.log(`[OK] ${checks} verificaciones HTTP/BD; iniciando limpieza.`);
} catch (error) {
  process.exitCode = 1;
  console.error("[ERROR PAYMENT METHODS HTTP]", error);
} finally {
  if (connected) {
    if (tx) await db.query("ROLLBACK").catch(()=>{});
    try { await cleanup(); } catch (error) { process.exitCode = 1; console.error("[ERROR LIMPIEZA]", error); }
    await db.end().catch(()=>{});
  }
  console.log(`CODIGO FINAL: ${process.exitCode || 0}`);
}
