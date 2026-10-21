import "dotenv/config";
import pg from "pg";
import { hash } from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const connection = process.env.DATABASE_URL;
assert.ok(connection, "DATABASE_URL no configurada");

const databaseUrl = new URL(connection);
const apiUrl = new URL(
  process.env.POS_HTTP_URL || "http://127.0.0.1:3000"
);

assert.ok(
  ["localhost", "127.0.0.1"].includes(databaseUrl.hostname) &&
  (!databaseUrl.port || databaseUrl.port === "5432") &&
  databaseUrl.pathname === "/pos_novnix" &&
  apiUrl.protocol === "http:" &&
  ["localhost", "127.0.0.1"].includes(apiUrl.hostname),
  "Solo se permite pos_novnix y una API HTTP local"
);

const db = new pg.Client({ connectionString: connection });
const tag = `CH${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const password = randomBytes(24).toString("base64url");

const ids = {
  companies: [],
  branches: [],
  users: [],
  roles: [],
};

let connected = false;
let transactionOpen = false;
let checks = 0;

function passed(label) {
  checks++;
  console.log(`[OK] ${label}`);
}

async function insert(type, sql, values) {
  const result = await db.query(sql, values);
  const id = String(result.rows[0].id);
  ids[type].push(id);
  return id;
}

async function http(method, path, token, body) {
  const response = await fetch(new URL(path, apiUrl), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(body !== undefined
      ? { body: JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(15000),
  });

  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

async function expectHttp(label, expected, method, path, token, body) {
  const result = await http(method, path, token, body);

  assert.equal(
    result.status,
    expected,
    `${label}: esperado HTTP ${expected}, recibido ${result.status}; ` +
    JSON.stringify(result.json)
  );

  passed(label);
  return result.json?.data;
}

async function login(user) {
  const response = await http("POST", "/api/v1/auth/login", null, {
    empresa_id: user.company,
    username: user.username,
    password,
  });

  assert.equal(response.status, 200);
  const token = response.json?.data?.access_token;
  assert.ok(token, "JWT no recibido");

  const me = await http("GET", "/api/v1/auth/me", token);
  assert.equal(me.status, 200);
  assert.equal(me.json?.data?.id, user.id);
  assert.equal(me.json?.data?.empresa?.id, user.company);

  return token;
}

try {
  await db.connect();
  connected = true;

  const current = await db.query(
    "SELECT current_database() AS name"
  );
  assert.equal(current.rows[0].name, "pos_novnix");
  passed("Base de pruebas confirmada");

  await db.query("BEGIN");
  transactionOpen = true;

  const main = await insert(
    "companies",
    `INSERT INTO pos.empresa (razon_social, nombre_comercial)
     VALUES ($1, $1) RETURNING id`,
    [`${tag}_MAIN`]
  );

  const foreign = await insert(
    "companies",
    `INSERT INTO pos.empresa (razon_social, nombre_comercial)
     VALUES ($1, $1) RETURNING id`,
    [`${tag}_FOREIGN`]
  );

  const branch = await insert(
    "branches",
    `INSERT INTO pos.sucursal (empresa_id, codigo, nombre)
     VALUES ($1, $2, 'Sucursal HTTP')
     RETURNING id`,
    [main, `B${tag}`]
  );

  const foreignBranch = await insert(
    "branches",
    `INSERT INTO pos.sucursal (empresa_id, codigo, nombre)
     VALUES ($1, $2, 'Sucursal HTTP externa')
     RETURNING id`,
    [foreign, `B${tag}`]
  );

  const required = [
    "CAJAS.VER", "CAJAS.CREAR", "CAJAS.EDITAR",
    "CAJAS.ABRIR", "CAJAS.MOVER", "CAJAS.CERRAR"
  ];

  const rows = await db.query(
    `SELECT id, codigo FROM pos.permiso
     WHERE codigo = ANY($1::text[])`,
    [required]
  );

  assert.equal(rows.rowCount, 6, "Faltan permisos de Cajas");

  const permissions = new Map(
    rows.rows.map(row => [row.codigo, row.id])
  );

  const fullRole = await insert(
    "roles",
    `INSERT INTO pos.rol (codigo, nombre)
     VALUES ($1, 'Operador HTTP Cajas') RETURNING id`,
    [`RF${tag}`]
  );

  const readRole = await insert(
    "roles",
    `INSERT INTO pos.rol (codigo, nombre)
     VALUES ($1, 'Lector HTTP Cajas') RETURNING id`,
    [`RV${tag}`]
  );

  for (const code of required) {
    await db.query(
      `INSERT INTO pos.rol_permiso (rol_id, permiso_id)
       VALUES ($1, $2)`,
      [fullRole, permissions.get(code)]
    );
  }

  await db.query(
    `INSERT INTO pos.rol_permiso (rol_id, permiso_id)
     VALUES ($1, $2)`,
    [readRole, permissions.get("CAJAS.VER")]
  );

  const passwordHash = await hash(password, 10);

  async function createUser(company, assignedBranch, role, prefix) {
    const username = `${prefix}_${tag}`;

    const id = await insert(
      "users",
      `INSERT INTO pos.usuario
       (empresa_id, username, password_hash, nombre)
       VALUES ($1, $2, $3, 'Prueba HTTP Cajas')
       RETURNING id`,
      [company, username, passwordHash]
    );

    await db.query(
      `INSERT INTO pos.usuario_rol (usuario_id, rol_id)
       VALUES ($1, $2)`,
      [id, role]
    );

    await db.query(
      `INSERT INTO pos.usuario_sucursal
       (usuario_id, sucursal_id) VALUES ($1, $2)`,
      [id, assignedBranch]
    );

    return { id, company, username };
  }

  const operator = await createUser(main, branch, fullRole, "op");
  const coworker = await createUser(main, branch, fullRole, "co");
  const reader = await createUser(main, branch, readRole, "rd");
  const outsider = await createUser(
    foreign, foreignBranch, fullRole, "ex"
  );

  await db.query("COMMIT");
  transactionOpen = false;
  passed("Empresas, sucursales, roles y usuarios creados");

  const operatorToken = await login(operator);
  const coworkerToken = await login(coworker);
  const readerToken = await login(reader);
  const foreignToken = await login(outsider);

  passed("Cuatro usuarios autenticados mediante JWT");

  await expectHttp(
    "Consulta sin autenticación", 401,
    "GET", "/api/v1/cash"
  );

  await expectHttp(
    "Consulta con JWT inválido", 401,
    "GET", "/api/v1/cash", "invalid-token"
  );

  await expectHttp(
    "Lector autorizado", 200,
    "GET", "/api/v1/cash", readerToken
  );

  const cashBody = {
    sucursal_id: branch,
    codigo: `C${tag}`,
    nombre: "Caja temporal HTTP",
  };

  await expectHttp(
    "Lector no puede crear caja", 403,
    "POST", "/api/v1/cash", readerToken, cashBody
  );

  await expectHttp(
    "Creación con datos inválidos", 400,
    "POST", "/api/v1/cash", operatorToken, {}
  );

  await expectHttp(
    "Sucursal ajena rechazada", 403,
    "POST", "/api/v1/cash", foreignToken, cashBody
  );

  const created = await expectHttp(
    "Crear caja", 201,
    "POST", "/api/v1/cash", operatorToken, cashBody
  );

  const cashId = String(created?.id);
  assert.match(cashId, /^[1-9]\d*$/);

  await expectHttp(
    "Caja duplicada rechazada", 409,
    "POST", "/api/v1/cash", operatorToken, cashBody
  );

  await expectHttp(
    "Consultar caja", 200,
    "GET", `/api/v1/cash/${cashId}`, readerToken
  );

  await expectHttp(
    "Empresa diferente no consulta caja", 404,
    "GET", `/api/v1/cash/${cashId}`, foreignToken
  );

  await expectHttp(
    "Lector no puede editar", 403,
    "PATCH", `/api/v1/cash/${cashId}`,
    readerToken, { nombre: "No autorizado" }
  );

  await expectHttp(
    "Actualizar caja", 200,
    "PATCH", `/api/v1/cash/${cashId}`,
    operatorToken, { nombre: "Caja HTTP actualizada" }
  );

  const opened = await expectHttp(
    "Abrir sesión", 201,
    "POST", `/api/v1/cash/${cashId}/sessions`,
    operatorToken, { monto_apertura: "100.00" }
  );

  const sessionId = String(opened?.id);
  assert.match(sessionId, /^[1-9]\d*$/);

  await expectHttp(
    "Segunda apertura rechazada", 409,
    "POST", `/api/v1/cash/${cashId}/sessions`,
    operatorToken, { monto_apertura: "50.00" }
  );

  await expectHttp(
    "No desactivar caja abierta", 409,
    "PATCH", `/api/v1/cash/${cashId}`,
    operatorToken, { activo: false }
  );

  await expectHttp(
    "Consultar sesión actual", 200,
    "GET", `/api/v1/cash/${cashId}/sessions/current`,
    readerToken
  );

  await expectHttp(
    "Lector no registra movimientos", 403,
    "POST", `/api/v1/cash/sessions/${sessionId}/movements`,
    readerToken,
    {
      tipo: "ENTRADA", concepto: "Prueba",
      monto: "30.00", referencia: `IN_${tag}`
    }
  );

  await expectHttp(
    "Movimiento con monto cero rechazado", 400,
    "POST", `/api/v1/cash/sessions/${sessionId}/movements`,
    operatorToken,
    {
      tipo: "ENTRADA", concepto: "Prueba",
      monto: "0.00", referencia: `ZERO_${tag}`
    }
  );

  const incoming = {
    tipo: "ENTRADA",
    concepto: "Ingreso de prueba",
    monto: "30.00",
    referencia: `IN_${tag}`,
  };

  await expectHttp(
    "Registrar entrada", 201,
    "POST", `/api/v1/cash/sessions/${sessionId}/movements`,
    operatorToken, incoming
  );

  await expectHttp(
    "Registrar salida", 201,
    "POST", `/api/v1/cash/sessions/${sessionId}/movements`,
    operatorToken,
    {
      tipo: "SALIDA",
      concepto: "Retiro de prueba",
      monto: "20.00",
      referencia: `OUT_${tag}`,
    }
  );

  await expectHttp(
    "Movimiento duplicado rechazado", 409,
    "POST", `/api/v1/cash/sessions/${sessionId}/movements`,
    operatorToken, incoming
  );

  await expectHttp(
    "Retiro superior al saldo rechazado", 409,
    "POST", `/api/v1/cash/sessions/${sessionId}/movements`,
    operatorToken,
    {
      tipo: "SALIDA",
      concepto: "Retiro excesivo",
      monto: "111.00",
      referencia: `OVER_${tag}`,
    }
  );

  const movements = await expectHttp(
    "Consultar movimientos", 200,
    "GET", `/api/v1/cash/sessions/${sessionId}/movements`,
    readerToken
  );

  assert.equal(Number(movements?.total), 2);

  const session = await expectHttp(
    "Consultar balance actual", 200,
    "GET", `/api/v1/cash/sessions/${sessionId}`,
    readerToken
  );

  assert.equal(Number(session?.monto_esperado_actual), 110);

  await expectHttp(
    "Otro operador no puede cerrar", 403,
    "POST", `/api/v1/cash/sessions/${sessionId}/close`,
    coworkerToken, { monto_cierre: "109.00" }
  );

  const closed = await expectHttp(
    "Cerrar sesión", 200,
    "POST", `/api/v1/cash/sessions/${sessionId}/close`,
    operatorToken, { monto_cierre: "109.00" }
  );

  assert.equal(closed?.estado, "CERRADA");
  assert.equal(Number(closed?.monto_esperado), 110);
  assert.equal(Number(closed?.diferencia), -1);

  await expectHttp(
    "Movimiento posterior al cierre rechazado", 409,
    "POST", `/api/v1/cash/sessions/${sessionId}/movements`,
    operatorToken,
    {
      tipo: "ENTRADA", concepto: "Movimiento tardío",
      monto: "5.00", referencia: `LATE_${tag}`
    }
  );

  await expectHttp(
    "Doble cierre rechazado", 409,
    "POST", `/api/v1/cash/sessions/${sessionId}/close`,
    operatorToken, { monto_cierre: "109.00" }
  );

  const history = await expectHttp(
    "Historial de sesiones", 200,
    "GET", `/api/v1/cash/${cashId}/sessions`,
    readerToken
  );

  assert.ok(Number(history?.total) >= 1);

  await expectHttp(
    "Desactivar caja después del cierre", 200,
    "PATCH", `/api/v1/cash/${cashId}`,
    operatorToken, { activo: false }
  );

  const persisted = await db.query(
    `SELECT c.activo, s.estado, s.monto_esperado,
            s.diferencia
     FROM pos.caja c
     JOIN pos.sesion_caja s ON s.caja_id = c.id
     WHERE c.id = $1 AND s.id = $2`,
    [cashId, sessionId]
  );

  assert.equal(persisted.rowCount, 1);
  assert.equal(persisted.rows[0].activo, false);
  assert.equal(persisted.rows[0].estado, "CERRADA");
  assert.equal(Number(persisted.rows[0].monto_esperado), 110);
  assert.equal(Number(persisted.rows[0].diferencia), -1);

  passed("Persistencia final comprobada en PostgreSQL");

  console.log(`\n${checks} comprobaciones aprobadas.`);
} catch (error) {
  process.exitCode = 1;
  console.error("[ERROR]", error.message);
} finally {
  if (connected) {
    try {
      if (transactionOpen) {
        await db.query("ROLLBACK");
        transactionOpen = false;
      }

      await db.query("BEGIN");

      await db.query(
        `DELETE FROM pos.auditoria
         WHERE usuario_id = ANY($1::bigint[])`,
        [ids.users]
      );

      await db.query(
        `DELETE FROM pos.movimiento_caja
         WHERE sesion_caja_id IN (
           SELECT sc.id
           FROM pos.sesion_caja sc
           JOIN pos.caja c ON c.id = sc.caja_id
           WHERE c.sucursal_id = ANY($1::bigint[])
         )`,
        [ids.branches]
      );

      await db.query(
        `DELETE FROM pos.sesion_caja
         WHERE caja_id IN (
           SELECT id FROM pos.caja
           WHERE sucursal_id = ANY($1::bigint[])
         )`,
        [ids.branches]
      );

      await db.query(
        `DELETE FROM pos.caja
         WHERE sucursal_id = ANY($1::bigint[])`,
        [ids.branches]
      );

      await db.query(
        `DELETE FROM pos.usuario_sucursal
         WHERE usuario_id = ANY($1::bigint[])`,
        [ids.users]
      );

      await db.query(
        `DELETE FROM pos.usuario_rol
         WHERE usuario_id = ANY($1::bigint[])`,
        [ids.users]
      );

      await db.query(
        `DELETE FROM pos.usuario
         WHERE id = ANY($1::bigint[])`,
        [ids.users]
      );

      await db.query(
        `DELETE FROM pos.rol_permiso
         WHERE rol_id = ANY($1::bigint[])`,
        [ids.roles]
      );

      await db.query(
        `DELETE FROM pos.rol
         WHERE id = ANY($1::bigint[])`,
        [ids.roles]
      );

      await db.query(
        `DELETE FROM pos.sucursal
         WHERE id = ANY($1::bigint[])`,
        [ids.branches]
      );

      await db.query(
        `DELETE FROM pos.empresa
         WHERE id = ANY($1::bigint[])`,
        [ids.companies]
      );

      await db.query("COMMIT");

      const remaining = await db.query(
        `SELECT COUNT(*)::int AS total FROM pos.empresa
         WHERE id = ANY($1::bigint[])`,
        [ids.companies]
      );

      assert.equal(remaining.rows[0].total, 0);
      console.log("[OK] Limpieza de empresas sintéticas verificada");
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      process.exitCode = 1;
      console.error("[ERROR] Limpieza incompleta:", error.message);
      console.error("Marcador para revisión:", tag);
    } finally {
      await db.end().catch(() => {});
    }
  }
}
