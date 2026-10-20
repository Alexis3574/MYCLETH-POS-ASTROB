import "dotenv/config";
import pg from "pg";
import { hash } from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const connection = process.env.DATABASE_URL;
assert.ok(connection, "DATABASE_URL no configurada");

const dbUrl = new URL(connection);
const apiUrl = new URL(
  process.env.POS_HTTP_URL || "http://127.0.0.1:3000"
);

assert.ok(
  ["localhost", "127.0.0.1"].includes(dbUrl.hostname) &&
  (!dbUrl.port || dbUrl.port === "5432") &&
  dbUrl.pathname === "/pos_novnix" &&
  apiUrl.protocol === "http:" &&
  ["localhost", "127.0.0.1"].includes(apiUrl.hostname),
  "Solo se permiten pos_novnix y una API HTTP local"
);

const db = new pg.Client({ connectionString: connection });
const tag = `CU${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const password = randomBytes(24).toString("base64url");
const code = `CL_${tag}`;

const ids = {
  companies: [],
  roles: [],
  users: [],
};

let connected = false;
let transactionOpen = false;
let checks = 0;

function passed(label) {
  checks++;
  console.log(`[OK] ${label}`);
}

async function insert(group, sql, values) {
  const result = await db.query(sql, values);
  const id = String(result.rows[0].id);
  ids[group].push(id);
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

  return {
    status: response.status,
    json: await response.json().catch(() => null),
  };
}

async function check(label, expected, method, path, token, body) {
  const result = await http(method, path, token, body);

  assert.equal(
    result.status,
    expected,
    `${label}: esperado ${expected}, recibido ${result.status}; ` +
    JSON.stringify(result.json)
  );

  passed(label);
  return result.json?.data;
}

async function login(user) {
  const result = await check(
    `Login ${user.username}`,
    200,
    "POST",
    "/api/v1/auth/login",
    null,
    {
      empresa_id: user.company,
      username: user.username,
      password,
    }
  );

  const token = result?.access_token;
  assert.ok(token, "JWT no recibido");

  const profile = await check(
    `Identidad ${user.username}`,
    200,
    "GET",
    "/api/v1/auth/me",
    token
  );

  assert.equal(profile?.id, user.id);
  assert.equal(profile?.empresa?.id, user.company);

  return token;
}

try {
  await db.connect();
  connected = true;

  const current = await db.query(
    "SELECT current_database() AS name"
  );

  assert.equal(current.rows[0].name, "pos_novnix");
  passed("Base de pruebas PostgreSQL confirmada");

  await db.query("BEGIN");
  transactionOpen = true;

  const main = await insert(
    "companies",
    `INSERT INTO pos.empresa
     (razon_social, nombre_comercial)
     VALUES ($1, $1) RETURNING id`,
    [`${tag}_MAIN`]
  );

  const foreign = await insert(
    "companies",
    `INSERT INTO pos.empresa
     (razon_social, nombre_comercial)
     VALUES ($1, $1) RETURNING id`,
    [`${tag}_FOREIGN`]
  );

  const required = [
    "CLIENTES.VER",
    "CLIENTES.CREAR",
    "CLIENTES.EDITAR",
  ];

  const permissionRows = await db.query(
    `SELECT id, codigo FROM pos.permiso
     WHERE codigo = ANY($1::text[])`,
    [required]
  );

  assert.equal(permissionRows.rowCount, 3);

  const permissions = new Map(
    permissionRows.rows.map(row => [row.codigo, row.id])
  );

  const fullRole = await insert(
    "roles",
    `INSERT INTO pos.rol (codigo, nombre)
     VALUES ($1, 'Gestión HTTP Clientes') RETURNING id`,
    [`CF_${tag}`]
  );

  const readRole = await insert(
    "roles",
    `INSERT INTO pos.rol (codigo, nombre)
     VALUES ($1, 'Lectura HTTP Clientes') RETURNING id`,
    [`CR_${tag}`]
  );

  for (const permission of required) {
    await db.query(
      `INSERT INTO pos.rol_permiso (rol_id, permiso_id)
       VALUES ($1, $2)`,
      [fullRole, permissions.get(permission)]
    );
  }

  await db.query(
    `INSERT INTO pos.rol_permiso (rol_id, permiso_id)
     VALUES ($1, $2)`,
    [readRole, permissions.get("CLIENTES.VER")]
  );

  const passwordHash = await hash(password, 10);

  async function createUser(company, role, prefix) {
    const username = `${prefix}_${tag}`;

    const id = await insert(
      "users",
      `INSERT INTO pos.usuario
       (empresa_id, username, password_hash, nombre)
       VALUES ($1, $2, $3, 'Prueba HTTP Clientes')
       RETURNING id`,
      [company, username, passwordHash]
    );

    await db.query(
      `INSERT INTO pos.usuario_rol (usuario_id, rol_id)
       VALUES ($1, $2)`,
      [id, role]
    );

    return { id, company, username };
  }

  const admin = await createUser(main, fullRole, "admin");
  const reader = await createUser(main, readRole, "reader");
  const outsider = await createUser(foreign, fullRole, "foreign");

  await db.query("COMMIT");
  transactionOpen = false;

  passed("Empresas, roles y usuarios sintéticos creados");

  const adminToken = await login(admin);
  const readerToken = await login(reader);
  const foreignToken = await login(outsider);

  await check(
    "Clientes sin JWT", 401,
    "GET", "/api/v1/customers"
  );

  await check(
    "Clientes con JWT inválido", 401,
    "GET", "/api/v1/customers", "invalid-token"
  );

  await check(
    "Lector autorizado", 200,
    "GET", "/api/v1/customers", readerToken
  );

  const customerBody = {
    codigo: code,
    nombre: "Cliente HTTP temporal",
    email: "CLIENTE@EXAMPLE.COM",
    limite_credito: "200.00",
    dias_credito: 15,
  };

  await check(
    "Lector no puede crear", 403,
    "POST", "/api/v1/customers",
    readerToken, customerBody
  );

  await check(
    "Datos incompletos rechazados", 400,
    "POST", "/api/v1/customers",
    adminToken, {}
  );

  await check(
    "RFC inválido rechazado", 400,
    "POST", "/api/v1/customers",
    adminToken,
    { ...customerBody, rfc: "RFC_INVALIDO" }
  );

  await check(
    "Crédito negativo rechazado", 400,
    "POST", "/api/v1/customers",
    adminToken,
    { ...customerBody, limite_credito: "-10.00" }
  );

  await check(
    "Paginación inválida rechazada", 400,
    "GET", "/api/v1/customers?page=0",
    readerToken
  );

  const created = await check(
    "Crear cliente", 201,
    "POST", "/api/v1/customers",
    adminToken, customerBody
  );

  const customerId = String(created?.id);
  assert.match(customerId, /^[1-9]\d*$/);
  assert.equal(created.codigo, code);
  assert.equal(created.email, "cliente@example.com");

  await check(
    "Código duplicado rechazado", 409,
    "POST", "/api/v1/customers",
    adminToken, customerBody
  );

  const foreignCreated = await check(
    "Mismo código permitido en otra empresa", 201,
    "POST", "/api/v1/customers",
    foreignToken, customerBody
  );

  assert.notEqual(String(foreignCreated?.id), customerId);

  await check(
    "Consultar cliente", 200,
    "GET", `/api/v1/customers/${customerId}`,
    readerToken
  );

  const list = await check(
    "Buscar cliente por código", 200,
    "GET", `/api/v1/customers?q=${encodeURIComponent(code)}`,
    readerToken
  );

  assert.equal(Number(list?.total), 1);
  assert.equal(String(list.items[0].id), customerId);

  await check(
    "Empresa ajena no consulta cliente", 404,
    "GET", `/api/v1/customers/${customerId}`,
    foreignToken
  );

  await check(
    "Empresa ajena no modifica cliente", 404,
    "PATCH", `/api/v1/customers/${customerId}`,
    foreignToken,
    { nombre: "Intento de otra empresa" }
  );

  await check(
    "Empresa ajena no consulta direcciones", 404,
    "GET", `/api/v1/customers/${customerId}/addresses`,
    foreignToken
  );

  await check(
    "Lector no puede editar", 403,
    "PATCH", `/api/v1/customers/${customerId}`,
    readerToken,
    { nombre: "Cambio no autorizado" }
  );

  await check(
    "Campos desconocidos rechazados", 400,
    "PATCH", `/api/v1/customers/${customerId}`,
    adminToken,
    { empresa_id: foreign }
  );

  const updated = await check(
    "Actualizar cliente y crédito", 200,
    "PATCH", `/api/v1/customers/${customerId}`,
    adminToken,
    {
      nombre: "Cliente HTTP actualizado",
      limite_credito: "500.50",
      dias_credito: 30,
    }
  );

  assert.equal(updated.nombre, "Cliente HTTP actualizado");
  assert.equal(Number(updated.limite_credito), 500.50);
  assert.equal(updated.dias_credito, 30);

  const initiallyEmpty = await check(
    "Consultar direcciones inicialmente vacías", 200,
    "GET", `/api/v1/customers/${customerId}/addresses`,
    readerToken
  );

  assert.deepEqual(initiallyEmpty, []);

  await check(
    "Lector no puede crear direcciones", 403,
    "POST", `/api/v1/customers/${customerId}/addresses`,
    readerToken,
    { tipo: "FISCAL", calle: "Calle temporal" }
  );

  const fiscal = await check(
    "Crear primera dirección fiscal", 201,
    "POST", `/api/v1/customers/${customerId}/addresses`,
    adminToken,
    {
      tipo: "FISCAL",
      calle: "Calle Fiscal",
      codigo_postal: "01000",
    }
  );

  assert.equal(fiscal.es_principal, true);

  const fiscalId = String(fiscal.id);

  const delivery = await check(
    "Crear segunda dirección de envío", 201,
    "POST", `/api/v1/customers/${customerId}/addresses`,
    adminToken,
    {
      tipo: "ENVIO",
      calle: "Calle Envío",
    }
  );

  assert.equal(delivery.es_principal, false);

  const deliveryId = String(delivery.id);

  await check(
    "No quitar principal sin reemplazo", 409,
    "PATCH",
    `/api/v1/customers/${customerId}/addresses/${fiscalId}`,
    adminToken,
    { es_principal: false }
  );

  const promoted = await check(
    "Cambiar dirección principal", 200,
    "PATCH",
    `/api/v1/customers/${customerId}/addresses/${deliveryId}`,
    adminToken,
    { es_principal: true }
  );

  assert.equal(promoted.es_principal, true);

  const addresses = await check(
    "Consultar direcciones actualizadas", 200,
    "GET", `/api/v1/customers/${customerId}/addresses`,
    readerToken
  );

  assert.equal(addresses.length, 2);
  assert.equal(
    addresses.filter(address => address.es_principal).length,
    1
  );

  assert.equal(
    String(addresses.find(address => address.es_principal).id),
    deliveryId
  );

  await check(
    "No eliminar principal mientras existen otras", 409,
    "DELETE",
    `/api/v1/customers/${customerId}/addresses/${deliveryId}`,
    adminToken
  );

  await check(
    "Eliminar dirección secundaria", 200,
    "DELETE",
    `/api/v1/customers/${customerId}/addresses/${fiscalId}`,
    adminToken
  );

  await check(
    "Eliminar última dirección principal", 200,
    "DELETE",
    `/api/v1/customers/${customerId}/addresses/${deliveryId}`,
    adminToken
  );

  const noAddresses = await check(
    "Confirmar eliminación de direcciones", 200,
    "GET", `/api/v1/customers/${customerId}/addresses`,
    readerToken
  );

  assert.deepEqual(noAddresses, []);

  const persisted = await db.query(
    `SELECT nombre, limite_credito, dias_credito
     FROM pos.cliente
     WHERE id = $1 AND empresa_id = $2`,
    [customerId, main]
  );

  assert.equal(persisted.rowCount, 1);
  assert.equal(
    persisted.rows[0].nombre,
    "Cliente HTTP actualizado"
  );
  assert.equal(
    Number(persisted.rows[0].limite_credito),
    500.50
  );

  passed("Persistencia final comprobada en PostgreSQL");

  // Esta prueba puede revelar la diferencia Zod/PostgreSQL.
  await check(
    "Tipo de dirección inválido devuelve 400", 400,
    "POST", `/api/v1/customers/${customerId}/addresses`,
    adminToken,
    {
      tipo: "INVALIDO",
      calle: "Dirección que debe rechazarse",
    }
  );

  console.log(
    `\n${checks} comprobaciones HTTP y PostgreSQL aprobadas.`
  );

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
        `DELETE FROM pos.cliente_direccion
         WHERE cliente_id IN (
           SELECT id FROM pos.cliente
           WHERE empresa_id = ANY($1::bigint[])
         )`,
        [ids.companies]
      );

      await db.query(
        `DELETE FROM pos.cliente
         WHERE empresa_id = ANY($1::bigint[])`,
        [ids.companies]
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
        `DELETE FROM pos.empresa
         WHERE id = ANY($1::bigint[])`,
        [ids.companies]
      );

      await db.query("COMMIT");

      const remaining = await db.query(
        `SELECT
           (SELECT COUNT(*) FROM pos.empresa
            WHERE id = ANY($1::bigint[])) AS empresas,
           (SELECT COUNT(*) FROM pos.cliente
            WHERE empresa_id = ANY($1::bigint[])) AS clientes,
           (SELECT COUNT(*) FROM pos.auditoria
            WHERE usuario_id = ANY($2::bigint[])) AS auditorias`,
        [ids.companies, ids.users]
      );

      assert.equal(Number(remaining.rows[0].empresas), 0);
      assert.equal(Number(remaining.rows[0].clientes), 0);
      assert.equal(Number(remaining.rows[0].auditorias), 0);

      console.log(
        "[OK] Limpieza de empresas, clientes y auditoría verificada"
      );

    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      process.exitCode = 1;
      console.error(
        "[ERROR] Limpieza incompleta:",
        error.message
      );
      console.error("Marcador para revisión:", tag);
    } finally {
      await db.end().catch(() => {});
    }
  }
}
