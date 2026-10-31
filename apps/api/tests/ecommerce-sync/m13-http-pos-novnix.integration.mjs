import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import pg from "pg";

const mode = process.argv[2];
const markerRx = /^M13H_[A-F0-9]{10}$/;
const marker = mode === "--cleanup-marker"
  ? process.argv[3]
  : "M13H_" + randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();

function guard(value, message) {
  if (!value) throw new Error("[M13 SEGURIDAD] " + message);
}

guard(["--preflight", "--run", "--cleanup-marker"].includes(mode), "Modo inválido.");
guard(mode !== "--cleanup-marker" || markerRx.test(marker), "Marcador inválido.");
guard(process.env.POS_ALLOW_TEST_DB === "SI", "Configurar POS_ALLOW_TEST_DB=SI.");
guard(process.env.INVENTORY_SYNC_ENABLED === "false", "Deshabilitar worker.");
guard(process.env.NODE_ENV !== "production", "Producción prohibida.");

const url = new URL(process.env.DATABASE_URL || "");
guard(["postgres:", "postgresql:"].includes(url.protocol), "PostgreSQL requerido.");
guard(["localhost", "127.0.0.1"].includes(url.hostname), "Servidor no local.");
guard(!url.port || url.port === "5432", "Puerto no permitido.");
guard(decodeURIComponent(url.pathname) === "/pos_novnix", "Base incorrecta.");
guard(!url.searchParams.has("host"), "Host alternativo prohibido.");
guard(!url.searchParams.has("schema") || url.searchParams.get("schema") === "pos", "Esquema incorrecto.");

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000
});

const q = (sql, params = []) => db.query(sql, params);
const one = async (sql, params = []) => (await q(sql, params)).rows[0];
const id = async (sql, params = []) => (await one(sql, params)).id;

let server = null;
let fixtureCommitted = false;
let passed = 0;

function pass(message) {
  passed++;
  console.log("[PASS] " + message);
}

function usernames(tag) {
  const part = tag.slice(5).toLowerCase();
  return {
    A: `m13h_${part}_a`,
    B: `m13h_${part}_b`,
    U: `m13h_${part}_u`
  };
}

async function snapshot() {
  return one(`
    SELECT
      (SELECT count(*)::int FROM pos.empresa) AS empresas,
      (SELECT count(*)::int FROM pos.sucursal) AS sucursales,
      (SELECT count(*)::int FROM pos.usuario) AS usuarios,
      (SELECT count(*)::int FROM pos.rol) AS roles,
      (SELECT count(*)::int FROM pos.usuario_rol) AS usuarios_roles,
      (SELECT count(*)::int FROM pos.usuario_sucursal) AS usuarios_sucursales,
      (SELECT count(*)::int FROM pos.rol_permiso) AS roles_permisos,
      (SELECT count(*)::int FROM pos.movimiento_inventario) AS movimientos,
      (SELECT count(*)::int FROM pos.auditoria) AS auditorias,
      (SELECT count(*)::int FROM pos.sincronizacion_ecommerce_inventario) AS outbox,
      (SELECT COALESCE(sum(intentos),0)::text
         FROM pos.sincronizacion_ecommerce_inventario) AS intentos,
      (SELECT md5(COALESCE(
         string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), ''
       )) FROM pos.sincronizacion_ecommerce_inventario s) AS huella_outbox
  `);
}

async function preflight() {
  const dbinfo = await one(`
    SELECT current_database() AS db,
           inet_server_port() AS port,
           EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='pos') AS schema_ok
  `);

  guard(dbinfo.db === "pos_novnix" && dbinfo.port === 5432 && dbinfo.schema_ok,
    "Destino PostgreSQL incorrecto.");

  const permission = await one(`
    SELECT id::text AS id FROM pos.permiso
    WHERE codigo=$1 AND modulo=$2
  `, ["ECOMMERCE_SYNC.VER", "ECOMMERCE_SYNC"]);

  guard(permission, "Falta ECOMMERCE_SYNC.VER.");

  const event = await one(`
    SELECT s.id::text AS evento_id,
           su.id::text AS sucursal_id,
           su.empresa_id::text AS empresa_id
    FROM pos.sincronizacion_ecommerce_inventario s
    JOIN pos.movimiento_inventario m
      ON m.id=s.movimiento_inventario_id
    JOIN pos.almacen a ON a.id=m.almacen_id
    JOIN pos.sucursal su ON su.id=a.sucursal_id
    JOIN pos.producto p ON p.id=m.producto_id
    JOIN pos.empresa e ON e.id=su.empresa_id
    WHERE su.empresa_id=p.empresa_id AND e.activo=true
    ORDER BY s.id DESC
    LIMIT 1
  `);

  guard(event, "No hay evento histórico elegible.");

  const before = await snapshot();
  console.log("[M13] PREFLIGHT:", JSON.stringify({
    empresa: event.empresa_id,
    sucursal: event.sucursal_id,
    eventos: before.outbox
  }));

  return { permission, event, before };
}

async function fixture(ctx) {
  const names = usernames(marker);
  await q("BEGIN");

  try {
    await q("SET LOCAL lock_timeout='5s'");
    await q("SET LOCAL statement_timeout='20000ms'");

    const role = await id(`
      INSERT INTO pos.rol(codigo,nombre)
      VALUES ($1,'Rol temporal M13H') RETURNING id::text
    `, [`R_${marker}`]);

    await q(`
      INSERT INTO pos.rol_permiso(rol_id,permiso_id)
      VALUES ($1,$2)
    `, [role, ctx.permission.id]);

    const companyB = await id(`
      INSERT INTO pos.empresa(razon_social,nombre_comercial)
      VALUES ($1,$1) RETURNING id::text
    `, [`${marker}_B`]);

    const branchB = await id(`
      INSERT INTO pos.sucursal(empresa_id,codigo,nombre)
      VALUES ($1,$2,'Sucursal temporal M13H')
      RETURNING id::text
    `, [companyB, `S_${marker}_B`]);

    async function createUser(company, username, suffix) {
      return id(`
        INSERT INTO pos.usuario(
          empresa_id,username,password_hash,nombre
        ) VALUES ($1,$2,'M13H_TEST_NO_LOGIN',$3)
        RETURNING id::text
      `, [company, username, `${marker}_${suffix}`]);
    }

    const A = await createUser(ctx.event.empresa_id, names.A, "A");
    const B = await createUser(companyB, names.B, "B");
    const U = await createUser(ctx.event.empresa_id, names.U, "U");

    for (const user of [A, B, U]) {
      await q(`
        INSERT INTO pos.usuario_rol(usuario_id,rol_id)
        VALUES ($1,$2)
      `, [user, role]);
    }

    await q(`
      INSERT INTO pos.usuario_sucursal(usuario_id,sucursal_id)
      VALUES ($1,$2),($3,$4)
    `, [A, ctx.event.sucursal_id, B, branchB]);

    await q("COMMIT");
    fixtureCommitted = true;
    pass("Fixture sintético creado: " + marker);

    return {
      A: { userId: BigInt(A), empresaId: BigInt(ctx.event.empresa_id) },
      B: { userId: BigInt(B), empresaId: BigInt(companyB) },
      U: { userId: BigInt(U), empresaId: BigInt(ctx.event.empresa_id) },
      branchB
    };
  } catch (error) {
    await q("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function cleanup(tag) {
  guard(markerRx.test(tag), "Marcador de limpieza inválido.");
  const names = usernames(tag);

  await q("BEGIN");
  try {
    await q("SET LOCAL lock_timeout='5s'");
    await q("SET LOCAL statement_timeout='20000ms'");

    const role = await one(`
      SELECT id::text AS id FROM pos.rol
      WHERE codigo=$1 AND nombre='Rol temporal M13H'
      FOR UPDATE
    `, [`R_${tag}`]);

    const company = await one(`
      SELECT id::text AS id FROM pos.empresa
      WHERE razon_social=$1 AND nombre_comercial=$1
      FOR UPDATE
    `, [`${tag}_B`]);

    if (!role && !company) {
      await q("ROLLBACK");
      console.log("[M13] Marcador inexistente: nada que limpiar.");
      return;
    }

    assert.ok(role && company, "Fixture incompleto; limpieza bloqueada.");

    const users = (await q(`
      SELECT id::text AS id, username,
             empresa_id::text AS empresa_id,
             password_hash, nombre
      FROM pos.usuario
      WHERE username=ANY($1::text[])
      FOR UPDATE
    `, [[names.A, names.B, names.U]])).rows;

    assert.equal(users.length, 3, "Cantidad de usuarios inesperada.");

    for (const suffix of ["A", "B", "U"]) {
      const user = users.find(u => u.username === names[suffix]);
      assert.ok(user);
      assert.equal(user.nombre, `${tag}_${suffix}`);
      assert.equal(user.password_hash, "M13H_TEST_NO_LOGIN");
      if (suffix === "B") assert.equal(user.empresa_id, company.id);
      else assert.notEqual(user.empresa_id, company.id);
    }

    const userIds = users.map(u => u.id);

    const branches = (await q(`
      SELECT id::text AS id,codigo
      FROM pos.sucursal WHERE empresa_id=$1 FOR UPDATE
    `, [company.id])).rows;

    assert.equal(branches.length, 1);
    assert.equal(branches[0].codigo, `S_${tag}_B`);

    const perms = (await q(`
      SELECT rp.permiso_id::text AS permiso_id,p.codigo
      FROM pos.rol_permiso rp
      JOIN pos.permiso p ON p.id=rp.permiso_id
      WHERE rp.rol_id=$1
    `, [role.id])).rows;

    assert.equal(perms.length, 1);
    assert.equal(perms[0].codigo, "ECOMMERCE_SYNC.VER");

    const assigned = (await q(`
      SELECT usuario_id::text AS usuario_id,rol_id::text AS rol_id
      FROM pos.usuario_rol WHERE usuario_id=ANY($1::bigint[])
    `, [userIds])).rows;

    assert.equal(assigned.length, 3);
    assert.ok(assigned.every(x => x.rol_id === role.id));

    const branchesAssigned = (await q(`
      SELECT usuario_id::text AS usuario_id,
             sucursal_id::text AS sucursal_id
      FROM pos.usuario_sucursal
      WHERE usuario_id=ANY($1::bigint[])
    `, [userIds])).rows;

    assert.equal(branchesAssigned.length, 2);
    const userB = users.find(u => u.username === names.B);
    const userU = users.find(u => u.username === names.U);
    assert.ok(branchesAssigned.some(x =>
      x.usuario_id === userB.id && x.sucursal_id === branches[0].id));
    assert.ok(!branchesAssigned.some(x => x.usuario_id === userU.id));

    async function remove(sql, params, expected) {
      const result = await q(sql, params);
      assert.equal(result.rowCount, expected, "Limpieza no coincide.");
    }

    await remove("DELETE FROM pos.usuario_sucursal WHERE usuario_id=ANY($1::bigint[])", [userIds], 2);
    await remove("DELETE FROM pos.usuario_rol WHERE usuario_id=ANY($1::bigint[])", [userIds], 3);
    await remove("DELETE FROM pos.usuario WHERE id=ANY($1::bigint[])", [userIds], 3);
    await remove("DELETE FROM pos.rol_permiso WHERE rol_id=$1", [role.id], 1);
    await remove("DELETE FROM pos.rol WHERE id=$1", [role.id], 1);
    await remove("DELETE FROM pos.sucursal WHERE id=$1", [branches[0].id], 1);
    await remove("DELETE FROM pos.empresa WHERE id=$1", [company.id], 1);

    await q("COMMIT");
    console.log("[PASS] Limpieza sintética completada:", tag);
  } catch (error) {
    await q("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function run(ctx) {
  const actors = await fixture(ctx);
  const [{ app }, { tokenService }] = await Promise.all([
    import("../../src/app.js"),
    import("../../src/modules/auth/token.service.js")
  ]);

  const tokens = {};
  for (const key of ["A", "B", "U"]) {
    tokens[key] = await tokenService.createAccessToken({
      userId: actors[key].userId,
      empresaId: actors[key].empresaId
    });
  }

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api/v1/ecommerce-sync`;

  async function request(user, path, status) {
    const res = await fetch(base + path, {
      headers: { Authorization: `Bearer ${tokens[user]}` }
    });
    const body = await res.json();
    assert.equal(res.status, status, `${user} ${path}: ${JSON.stringify(body)}`);
    return body;
  }

  const list = await request("A", "?page=1&pageSize=10", 200);
  assert.ok(list.data.total > 0);
  assert.ok(list.data.items.length > 0);
  assert.ok(list.data.items.length <= 10);
  assert.ok(list.data.items.every(x =>
    x.movimiento.sucursal.id === ctx.event.sucursal_id));
  pass("JWT autorizado: listado HTTP 200, sucursal correcta");

  const summary = await request("A", "/summary", 200);
  assert.equal(summary.data.total, list.data.total);
  pass("Resumen HTTP 200 y totales coherentes");

  const diag = await request("A", "/diagnostics", 200);
  assert.ok(diag.data.max_intentos >= 0);
  pass("Diagnósticos HTTP 200");

  const detail = await request("A", `/${ctx.event.evento_id}`, 200);
  assert.equal(detail.data.id, ctx.event.evento_id);
  assert.equal("ultimo_error" in detail.data, false);
  pass("Detalle HTTP 200 sin ultimo_error");

  const filtered = await request("A", "?estado=SINCRONIZADO", 200);
  assert.ok(filtered.data.items.every(x => x.estado === "SINCRONIZADO"));
  pass("Filtro por estado");

  await request("A", "?empresa_id=1", 400);
  pass("Rechazo de empresa inyectada HTTP 400");

  await request("A", "?pageSize=101", 400);
  pass("Paginación fuera de límite HTTP 400");

  await request("A", "/1e5", 400);
  pass("ID ambiguo HTTP 400");

  await request("A", `?sucursal_id=${actors.branchB}`, 404);
  pass("Sucursal de otra empresa HTTP 404");

  const bList = await request("B", "", 200);
  assert.equal(bList.data.total, 0);
  pass("Usuario de otra empresa: listado vacío");

  await request("B", `/${ctx.event.evento_id}`, 404);
  pass("Usuario de otra empresa: evento HTTP 404");

  const bSummary = await request("B", "/summary", 200);
  assert.equal(bSummary.data.total, 0);
  pass("Usuario de otra empresa: resumen vacío");

  const uList = await request("U", "", 200);
  assert.equal(uList.data.total, 0);
  pass("Usuario sin sucursal asignada: listado vacío");

  await request("U", `/${ctx.event.evento_id}`, 404);
  pass("Usuario sin sucursal: evento HTTP 404");
}

async function main() {
  await db.connect();
  try {
    if (mode === "--cleanup-marker") {
      await cleanup(marker);
      return;
    }

    const ctx = await preflight();
    if (mode === "--preflight") {
      console.log("[M13] PRE-FLIGHT aprobado; sin escrituras.");
      return;
    }

    console.log("[M13] MARCADOR DE RECUPERACIÓN:", marker);

    let failure = null;
    try {
      await run(ctx);
      console.log(`[M13] ${passed} verificaciones aprobadas.`);
    } catch (error) {
      failure = error;
    } finally {
      if (server) {
        await new Promise(resolve => server.close(resolve));
      }
      if (fixtureCommitted) {
        await cleanup(marker);
        const after = await snapshot();
        assert.deepEqual(after, ctx.before, "Los datos globales cambiaron.");
        console.log("[PASS] Conteos y huella del outbox restaurados.");
      }
    }

    if (failure) throw failure;
    console.log("[M13] INTEGRACIÓN FUNCIONAL APROBADA.");
  } finally {
    await db.end();
  }
}

main().catch(error => {
  console.error("[M13 ERROR]", error);
  console.error("[M13 MARCADOR]", marker);
  console.error("Si quedó un fixture, utilizar --cleanup-marker", marker);
  process.exitCode = 1;
});
