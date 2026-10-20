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

const db = new pg.Client({
  connectionString: connection,
  connectionTimeoutMillis: 5000,
});

const tag = `SU${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const code = `SP_${tag}`;
const password = randomBytes(24).toString("base64url");

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

async function check(label, status, method, path, token, body) {
  const response = await http(method, path, token, body);

  assert.equal(
    response.status,
    status,
    `${label}: esperado HTTP ${status}, recibido ` +
    `${response.status}; ${JSON.stringify(response.json)}`
  );

  passed(label);
  return response.json?.data;
}

async function login(user) {
  const data = await check(
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

  const token = data?.access_token;
  assert.ok(token, "JWT no recibido");

  const profile = await check(
    `Identidad ${user.username}`,
    200,
    "GET",
    "/api/v1/auth/me",
    token
  );

  assert.equal(String(profile?.id), user.id);
  assert.equal(String(profile?.empresa?.id), user.company);

  return token;
}

try {
  await db.connect();
  connected = true;

  const current = await db.query(
    "SELECT current_database() AS name"
  );

  assert.equal(current.rows[0].name, "pos_novnix");
  passed("Base PostgreSQL autorizada");

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
    "PROVEEDORES.VER",
    "PROVEEDORES.CREAR",
    "PROVEEDORES.EDITAR",
  ];

  const permissionRows = await db.query(
    `SELECT id, codigo FROM pos.permiso
     WHERE codigo = ANY($1::text[])`,
    [required]
  );

  assert.equal(
    permissionRows.rowCount,
    3,
    "Faltan permisos de Proveedores"
  );

  const permissions = new Map(
    permissionRows.rows.map(row => [row.codigo, row.id])
  );

  const fullRole = await insert(
    "roles",
    `INSERT INTO pos.rol (codigo, nombre)
     VALUES ($1, 'Gestión HTTP Proveedores')
     RETURNING id`,
    [`SF_${tag}`]
  );

  const readRole = await insert(
    "roles",
    `INSERT INTO pos.rol (codigo, nombre)
     VALUES ($1, 'Lectura HTTP Proveedores')
     RETURNING id`,
    [`SR_${tag}`]
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
    [readRole, permissions.get("PROVEEDORES.VER")]
  );

  const passwordHash = await hash(password, 10);

  async function createUser(company, role, prefix) {
    const username = `${prefix}_${tag}`;

    const id = await insert(
      "users",
      `INSERT INTO pos.usuario
       (empresa_id, username, password_hash, nombre)
       VALUES ($1, $2, $3, 'Prueba HTTP Proveedores')
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
  const outsider = await createUser(
    foreign,
    fullRole,
    "foreign"
  );

  await db.query("COMMIT");
  transactionOpen = false;

  passed("Empresas, roles y usuarios sintéticos creados");

  const adminToken = await login(admin);
  const readerToken = await login(reader);
  const foreignToken = await login(outsider);

  const base = "/api/v1/suppliers";

  await check(
    "Consulta sin JWT",
    401, "GET", base
  );

  await check(
    "JWT inválido rechazado",
    401, "GET", base, "invalid-token"
  );

  await check(
    "Lector autorizado",
    200, "GET", base, readerToken
  );

  const body = {
    codigo: code,
    razon_social: "Proveedor HTTP temporal",
    nombre_comercial: "Proveedor temporal",
    email: "PROVEEDOR@EXAMPLE.COM",
    contacto: "Contacto de prueba",
    dias_credito: 15,
  };

  await check(
    "Lector no puede crear",
    403, "POST", base, readerToken, body
  );

  await check(
    "Datos incompletos rechazados",
    400, "POST", base, adminToken, {}
  );

  await check(
    "RFC inválido rechazado",
    400, "POST", base, adminToken,
    { ...body, rfc: "RFC_INVALIDO" }
  );

  await check(
    "Días de crédito negativos rechazados",
    400, "POST", base, adminToken,
    { ...body, dias_credito: -1 }
  );

  await check(
    "Paginación inválida rechazada",
    400, "GET", `${base}?page=0`, readerToken
  );

  const created = await check(
    "Crear proveedor",
    201, "POST", base, adminToken, body
  );

  const supplierId = String(created?.id);
  assert.match(supplierId, /^[1-9]\d*$/);
  assert.equal(created.codigo, code);
  assert.equal(created.email, "proveedor@example.com");

  await check(
    "Código duplicado rechazado",
    409, "POST", base, adminToken, body
  );

  const foreignCreated = await check(
    "Mismo código permitido en otra empresa",
    201, "POST", base, foreignToken, body
  );

  assert.notEqual(String(foreignCreated?.id), supplierId);

  await check(
    "Consultar proveedor",
    200, "GET", `${base}/${supplierId}`,
    readerToken
  );

  const listed = await check(
    "Búsqueda por código",
    200, "GET",
    `${base}?q=${encodeURIComponent(code)}`,
    readerToken
  );

  assert.equal(Number(listed?.total), 1);
  assert.equal(String(listed.items[0].id), supplierId);

  await check(
    "Empresa ajena no consulta proveedor",
    404, "GET", `${base}/${supplierId}`,
    foreignToken
  );

  await check(
    "Empresa ajena no actualiza proveedor",
    404, "PATCH", `${base}/${supplierId}`,
    foreignToken,
    { razon_social: "Cambio ajeno" }
  );

  await check(
    "Empresa ajena no consulta direcciones",
    404, "GET", `${base}/${supplierId}/addresses`,
    foreignToken
  );

  await check(
    "Lector no puede editar",
    403, "PATCH", `${base}/${supplierId}`,
    readerToken,
    { razon_social: "Cambio no autorizado" }
  );

  await check(
    "Campos no permitidos rechazados",
    400, "PATCH", `${base}/${supplierId}`,
    adminToken,
    { empresa_id: foreign }
  );

  const updated = await check(
    "Actualizar proveedor",
    200, "PATCH", `${base}/${supplierId}`,
    adminToken,
    {
      razon_social: "Proveedor HTTP actualizado",
      dias_credito: 30,
      contacto: "Contacto actualizado",
    }
  );

  assert.equal(
    updated.razon_social,
    "Proveedor HTTP actualizado"
  );
  assert.equal(updated.dias_credito, 30);

  const addressesPath = `${base}/${supplierId}/addresses`;

  const empty = await check(
    "Direcciones inicialmente vacías",
    200, "GET", addressesPath, readerToken
  );

  assert.deepEqual(empty, []);

  await check(
    "Lector no puede crear direcciones",
    403, "POST", addressesPath,
    readerToken,
    { tipo: "FISCAL", calle: "Calle temporal" }
  );

  await check(
    "Primera dirección no puede ser secundaria",
    409, "POST", addressesPath,
    adminToken,
    {
      tipo: "FISCAL",
      calle: "Calle no principal",
      es_principal: false,
    }
  );

  await check(
    "Tipo ENVIO rechazado en Proveedores",
    400, "POST", addressesPath,
    adminToken,
    { tipo: "ENVIO", calle: "Tipo no permitido" }
  );

  await check(
    "Tipo de dirección desconocido rechazado",
    400, "POST", addressesPath,
    adminToken,
    { tipo: "INVALIDO", calle: "Tipo inválido" }
  );

  const fiscal = await check(
    "Crear dirección fiscal principal",
    201, "POST", addressesPath,
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
    "Crear dirección de entrega",
    201, "POST", addressesPath,
    adminToken,
    {
      tipo: "ENTREGA",
      calle: "Calle Entrega",
    }
  );

  assert.equal(delivery.es_principal, false);
  const deliveryId = String(delivery.id);

  await check(
    "No quitar dirección principal sin reemplazo",
    409, "PATCH",
    `${addressesPath}/${fiscalId}`,
    adminToken,
    { es_principal: false }
  );

  await check(
    "Lector no puede editar direcciones",
    403, "PATCH",
    `${addressesPath}/${fiscalId}`,
    readerToken,
    { calle: "Cambio no autorizado" }
  );

  await check(
    "Tipo inválido rechazado al actualizar",
    400, "PATCH",
    `${addressesPath}/${deliveryId}`,
    adminToken,
    { tipo: "ENVIO" }
  );

  const promoted = await check(
    "Cambiar dirección principal",
    200, "PATCH",
    `${addressesPath}/${deliveryId}`,
    adminToken,
    { es_principal: true }
  );

  assert.equal(promoted.es_principal, true);

  const addresses = await check(
    "Consultar direcciones actualizadas",
    200, "GET", addressesPath, readerToken
  );

  assert.equal(addresses.length, 2);

  const principals = addresses.filter(
    address => address.es_principal
  );

  assert.equal(principals.length, 1);
  assert.equal(String(principals[0].id), deliveryId);

  await check(
    "Empresa ajena no modifica dirección",
    404, "PATCH",
    `${addressesPath}/${deliveryId}`,
    foreignToken,
    { calle: "Intento externo" }
  );

  await check(
    "No eliminar principal con otras direcciones",
    409, "DELETE",
    `${addressesPath}/${deliveryId}`,
    adminToken
  );

  await check(
    "Lector no puede eliminar direcciones",
    403, "DELETE",
    `${addressesPath}/${fiscalId}`,
    readerToken
  );

  await check(
    "Eliminar dirección secundaria",
    200, "DELETE",
    `${addressesPath}/${fiscalId}`,
    adminToken
  );

  await check(
    "Eliminar última dirección principal",
    200, "DELETE",
    `${addressesPath}/${deliveryId}`,
    adminToken
  );

  const finalAddresses = await check(
    "Confirmar direcciones eliminadas",
    200, "GET", addressesPath, readerToken
  );

  assert.deepEqual(finalAddresses, []);

  const disabled = await check(
    "Desactivar proveedor",
    200, "PATCH", `${base}/${supplierId}`,
    adminToken,
    { activo: false }
  );

  assert.equal(disabled.activo, false);

  const inactive = await check(
    "Filtrar proveedores inactivos",
    200, "GET",
    `${base}?activo=false&q=${encodeURIComponent(code)}`,
    readerToken
  );

  assert.equal(Number(inactive.total), 1);

  const persisted = await db.query(
    `SELECT razon_social, dias_credito, activo, contacto
     FROM pos.proveedor
     WHERE id = $1 AND empresa_id = $2`,
    [supplierId, main]
  );

  assert.equal(persisted.rowCount, 1);
  assert.equal(
    persisted.rows[0].razon_social,
    "Proveedor HTTP actualizado"
  );
  assert.equal(persisted.rows[0].dias_credito, 30);
  assert.equal(persisted.rows[0].activo, false);
  assert.equal(
    persisted.rows[0].contacto,
    "Contacto actualizado"
  );

  passed("Persistencia final verificada en PostgreSQL");

  const audit = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM pos.auditoria
     WHERE usuario_id = $1`,
    [admin.id]
  );

  assert.ok(audit.rows[0].total > 0);
  passed("Auditoría del proveedor comprobada");

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
        `DELETE FROM pos.proveedor_direccion
         WHERE proveedor_id IN (
           SELECT id FROM pos.proveedor
           WHERE empresa_id = ANY($1::bigint[])
         )`,
        [ids.companies]
      );

      await db.query(
        `DELETE FROM pos.proveedor
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
           (SELECT COUNT(*) FROM pos.proveedor
            WHERE empresa_id = ANY($1::bigint[])) AS proveedores,
           (SELECT COUNT(*) FROM pos.auditoria
            WHERE usuario_id = ANY($2::bigint[])) AS auditorias`,
        [ids.companies, ids.users]
      );

      assert.equal(Number(remaining.rows[0].empresas), 0);
      assert.equal(Number(remaining.rows[0].proveedores), 0);
      assert.equal(Number(remaining.rows[0].auditorias), 0);

      console.log(
        "[OK] Limpieza de empresas, proveedores y auditoría verificada"
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
