import dotenv from "dotenv";
import pg from "pg";
import { hash } from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

dotenv.config({ quiet: true });

const dbUrl = new URL(process.env.DATABASE_URL || "");
const apiUrl = new URL(
  process.env.POS_HTTP_URL || "http://127.0.0.1:3000"
);

if (
  !["localhost", "127.0.0.1"].includes(dbUrl.hostname) ||
  (dbUrl.port && dbUrl.port !== "5432") ||
  dbUrl.pathname !== "/pos_novnix" ||
  apiUrl.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(apiUrl.hostname)
) {
  throw new Error("Se requiere pos_novnix y una API local.");
}

const { Client } = pg;
const db = new Client({
  connectionString: process.env.DATABASE_URL,
});

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const marker = `POS_PRODUCT_HTTP_${suffix}`;
const password = randomBytes(24).toString("base64url");
const sku = `PH_${suffix}`;
const barcode = `PB_${suffix}`;

const companyIds = [];
const roleIds = [];
let unitId = null;
let checks = 0;
let connected = false;

function passed(name) {
  checks++;
  console.log(`[OK] ${name}`);
}

async function insert(sql, params) {
  const result = await db.query(sql, params);
  return result.rows[0].id;
}

async function request(method, path, token, body) {
  const response = await fetch(
    new URL(path, apiUrl),
    {
      method,
      headers: {
        ...(token
          ? { Authorization: `Bearer ${token}` }
          : {}),
        ...(body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(body !== undefined
        ? { body: JSON.stringify(body) }
        : {}),
      signal: AbortSignal.timeout(15000),
    }
  );

  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function expectStatus(
  name, expected, method, path, token, body
) {
  const result = await request(method, path, token, body);

  assert.equal(
    result.status,
    expected,
    `${name}: esperado ${expected}, recibido ${result.status}, respuesta: ${JSON.stringify(result.data)}`
  );

  passed(name);
  return result.data;
}

async function login(companyId, username, userId) {
  const response = await request(
    "POST",
    "/api/v1/auth/login",
    null,
    {
      empresa_id: String(companyId),
      username,
      password,
    }
  );

  assert.equal(response.status, 200);
  const token = response.data?.data?.access_token;
  assert.ok(token);

  const me = await request(
    "GET",
    "/api/v1/auth/me",
    token
  );

  assert.equal(me.status, 200);
  assert.equal(me.data?.data?.id, String(userId));
  assert.equal(
    me.data?.data?.empresa?.id,
    String(companyId)
  );

  return token;
}

try {
  await db.connect();
  connected = true;

  const database = await db.query(
    "SELECT current_database() AS nombre"
  );

  assert.equal(database.rows[0].nombre, "pos_novnix");
  passed("Conexión PostgreSQL autorizada");

  await db.query("BEGIN");

  let companyMain;
  let companyForeign;
  let categoryMain;
  let categoryForeign;
  let taxMain;
  let taxForeign;
  let writer;
  let reader;
  let foreignUser;

  try {
    companyMain = await insert(
      `INSERT INTO pos.empresa
       (razon_social, nombre_comercial)
       VALUES ($1, $1) RETURNING id`,
      [`${marker}_MAIN`]
    );
    companyIds.push(companyMain);

    companyForeign = await insert(
      `INSERT INTO pos.empresa
       (razon_social, nombre_comercial)
       VALUES ($1, $1) RETURNING id`,
      [`${marker}_FOREIGN`]
    );
    companyIds.push(companyForeign);

    unitId = await insert(
      `INSERT INTO pos.unidad_medida
       (codigo, nombre, permite_decimales)
       VALUES ($1, 'Unidad HTTP temporal', true)
       RETURNING id`,
      [`U${suffix}`]
    );

    categoryMain = await insert(
      `INSERT INTO pos.categoria
       (empresa_id, nombre)
       VALUES ($1, $2) RETURNING id`,
      [companyMain, `CAT_${suffix}`]
    );

    categoryForeign = await insert(
      `INSERT INTO pos.categoria
       (empresa_id, nombre)
       VALUES ($1, $2) RETURNING id`,
      [companyForeign, `CAT_${suffix}`]
    );

    taxMain = await insert(
      `INSERT INTO pos.impuesto
       (empresa_id, codigo, nombre, tasa)
       VALUES ($1, $2, 'Impuesto HTTP', 0.1600)
       RETURNING id`,
      [companyMain, `T${suffix}`]
    );

    taxForeign = await insert(
      `INSERT INTO pos.impuesto
       (empresa_id, codigo, nombre, tasa)
       VALUES ($1, $2, 'Impuesto HTTP', 0.1600)
       RETURNING id`,
      [companyForeign, `T${suffix}`]
    );

    const permissionCodes = [
      "PRODUCTOS.VER",
      "PRODUCTOS.CREAR",
      "PRODUCTOS.EDITAR",
      "PRODUCTOS.CAMBIAR_ESTADO",
    ];

    const result = await db.query(
      `SELECT id, codigo FROM pos.permiso
       WHERE codigo = ANY($1::text[])`,
      [permissionCodes]
    );

    assert.equal(result.rowCount, 4);

    const permissions = new Map(
      result.rows.map((r) => [r.codigo, r.id])
    );

    const fullRole = await insert(
      `INSERT INTO pos.rol (codigo, nombre)
       VALUES ($1, 'Pruebas HTTP productos')
       RETURNING id`,
      [`PH_FULL_${suffix}`]
    );
    roleIds.push(fullRole);

    const readRole = await insert(
      `INSERT INTO pos.rol (codigo, nombre)
       VALUES ($1, 'Consulta HTTP productos')
       RETURNING id`,
      [`PH_READ_${suffix}`]
    );
    roleIds.push(readRole);

    for (const code of permissionCodes) {
      await db.query(
        `INSERT INTO pos.rol_permiso
         (rol_id, permiso_id) VALUES ($1, $2)`,
        [fullRole, permissions.get(code)]
      );
    }

    await db.query(
      `INSERT INTO pos.rol_permiso
       (rol_id, permiso_id) VALUES ($1, $2)`,
      [readRole, permissions.get("PRODUCTOS.VER")]
    );

    const passwordHash = await hash(password, 10);

    async function makeUser(companyId, username, roleId) {
      const id = await insert(
        `INSERT INTO pos.usuario
         (empresa_id, username, password_hash, nombre)
         VALUES ($1, $2, $3, 'Prueba HTTP')
         RETURNING id`,
        [companyId, username, passwordHash]
      );

      await db.query(
        `INSERT INTO pos.usuario_rol
         (usuario_id, rol_id) VALUES ($1, $2)`,
        [id, roleId]
      );

      return { id, companyId, username };
    }

    writer = await makeUser(
      companyMain, `ph_writer_${suffix}`, fullRole
    );
    reader = await makeUser(
      companyMain, `ph_reader_${suffix}`, readRole
    );
    foreignUser = await makeUser(
      companyForeign, `ph_foreign_${suffix}`, fullRole
    );

    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }

  passed("Empresas, catálogos, roles y usuarios creados");

  const writerToken = await login(
    writer.companyId, writer.username, writer.id
  );
  const readerToken = await login(
    reader.companyId, reader.username, reader.id
  );
  const foreignToken = await login(
    foreignUser.companyId,
    foreignUser.username,
    foreignUser.id
  );

  passed("Tres JWT autenticados y verificados");

  await expectStatus(
    "Productos sin token", 401,
    "GET", "/api/v1/products"
  );

  await expectStatus(
    "Productos con token inválido", 401,
    "GET", "/api/v1/products", "invalid-token"
  );

  for (const catalog of ["categories", "units", "taxes"]) {
    await expectStatus(
      `Catálogo ${catalog}`, 200,
      "GET", `/api/v1/${catalog}`,
      readerToken
    );
  }

  await expectStatus(
    "Paginación inválida", 400,
    "GET", "/api/v1/products?page=0",
    writerToken
  );

  const productBody = {
    sku,
    codigo_barras: barcode,
    nombre: "Producto HTTP temporal",
    unidad_medida_id: String(unitId),
    categoria_id: String(categoryMain),
    impuesto_ids: [String(taxMain)],
    precio_venta: "125.50",
    costo_referencia: "85.2500",
    stock_minimo: "1.000",
    stock_maximo: "20.000",
  };

  await expectStatus(
    "Usuario de consulta no puede crear", 403,
    "POST", "/api/v1/products",
    readerToken, productBody
  );

  await expectStatus(
    "Categoría de otra empresa rechazada", 400,
    "POST", "/api/v1/products",
    writerToken,
    { ...productBody, categoria_id: String(categoryForeign) }
  );

  await expectStatus(
    "Impuesto de otra empresa rechazado", 400,
    "POST", "/api/v1/products",
    writerToken,
    { ...productBody, impuesto_ids: [String(taxForeign)] }
  );

  await expectStatus(
    "Rango de stock inválido", 400,
    "POST", "/api/v1/products",
    writerToken,
    { ...productBody, stock_minimo: "30.000" }
  );

  await expectStatus(
    "Servicio con inventario rechazado", 400,
    "POST", "/api/v1/products",
    writerToken,
    {
      ...productBody,
      tipo: "SERVICIO",
      controla_inventario: true,
    }
  );

  const created = await expectStatus(
    "Creación de producto", 201,
    "POST", "/api/v1/products",
    writerToken, productBody
  );

  const productId = created?.data?.id;
  assert.ok(productId);
  assert.equal(created.data.sku, sku);
  assert.equal(created.data.precio_venta, "125.50");
  assert.equal(created.data.impuestos.length, 1);

  await expectStatus(
    "SKU duplicado", 409,
    "POST", "/api/v1/products",
    writerToken, productBody
  );

  await expectStatus(
    "Código de barras duplicado", 409,
    "POST", "/api/v1/products",
    writerToken,
    { ...productBody, sku: `${sku}_OTHER` }
  );

  await expectStatus(
    "Consulta de producto por ID", 200,
    "GET", `/api/v1/products/${productId}`,
    readerToken
  );

  await expectStatus(
    "Consulta por código de barras", 200,
    "GET", `/api/v1/products/barcode/${barcode}`,
    readerToken
  );

  const listed = await expectStatus(
    "Filtro por SKU", 200,
    "GET", `/api/v1/products?sku=${sku}`,
    readerToken
  );

  assert.equal(listed?.data?.length, 1);
  assert.equal(listed.data[0].id, String(productId));

  await expectStatus(
    "Empresa ajena no puede consultar producto", 404,
    "GET", `/api/v1/products/${productId}`,
    foreignToken
  );

  await expectStatus(
    "Empresa ajena no puede actualizar", 404,
    "PATCH", `/api/v1/products/${productId}`,
    foreignToken,
    { nombre: "Intento ajeno" }
  );

  await expectStatus(
    "Usuario de consulta no puede editar", 403,
    "PATCH", `/api/v1/products/${productId}`,
    readerToken,
    { nombre: "Intento sin permiso" }
  );

  await expectStatus(
    "Campos protegidos no editables", 400,
    "PATCH", `/api/v1/products/${productId}`,
    writerToken,
    { sku: "SKU_PROHIBIDO" }
  );

  const updated = await expectStatus(
    "Actualización de producto", 200,
    "PATCH", `/api/v1/products/${productId}`,
    writerToken,
    {
      nombre: "Producto HTTP actualizado",
      precio_venta: "150.00",
    }
  );

  assert.equal(
    updated.data.nombre,
    "Producto HTTP actualizado"
  );
  assert.equal(updated.data.precio_venta, "150.00");

  await expectStatus(
    "Usuario de consulta no puede cambiar estado", 403,
    "PATCH", `/api/v1/products/${productId}/status`,
    readerToken,
    { activo: false }
  );

  const disabled = await expectStatus(
    "Desactivar producto", 200,
    "PATCH", `/api/v1/products/${productId}/status`,
    writerToken,
    { activo: false }
  );

  assert.equal(disabled.data.activo, false);

  await expectStatus(
    "Código de barras inactivo no disponible", 404,
    "GET", `/api/v1/products/barcode/${barcode}`,
    readerToken
  );

  const enabled = await expectStatus(
    "Reactivar producto", 200,
    "PATCH", `/api/v1/products/${productId}/status`,
    writerToken,
    { activo: true }
  );

  assert.equal(enabled.data.activo, true);

  const persisted = await db.query(
    `SELECT empresa_id, nombre, activo
     FROM pos.producto WHERE id = $1`,
    [productId]
  );

  assert.equal(
    String(persisted.rows[0].empresa_id),
    String(companyMain)
  );
  assert.equal(
    persisted.rows[0].nombre,
    "Producto HTTP actualizado"
  );
  assert.equal(persisted.rows[0].activo, true);

  passed("Persistencia final comprobada en PostgreSQL");

  console.log(`\n${checks} comprobaciones HTTP y PostgreSQL correctas.`);
} catch (error) {
  process.exitCode = 1;
  console.error("[ERROR]", error.message);
} finally {
  if (connected) {
    try {
      await db.query("BEGIN");

      if (companyIds.length) {
        await db.query(
          `DELETE FROM pos.producto_impuesto pi
           USING pos.producto p
           WHERE pi.producto_id = p.id
             AND p.empresa_id = ANY($1::bigint[])`,
          [companyIds]
        );

        for (const table of [
          "producto",
          "categoria",
          "impuesto",
          "usuario",
        ]) {
          await db.query(
            `DELETE FROM pos.${table}
             WHERE empresa_id = ANY($1::bigint[])`,
            [companyIds]
          );
        }
      }

      if (roleIds.length) {
        await db.query(
          `DELETE FROM pos.rol
           WHERE id = ANY($1::bigint[])`,
          [roleIds]
        );
      }

      if (unitId !== null) {
        await db.query(
          `DELETE FROM pos.unidad_medida WHERE id = $1`,
          [unitId]
        );
      }

      if (companyIds.length) {
        await db.query(
          `DELETE FROM pos.empresa
           WHERE id = ANY($1::bigint[])`,
          [companyIds]
        );
      }

      await db.query("COMMIT");

      const remaining = await db.query(
        `SELECT
           (SELECT COUNT(*) FROM pos.empresa
            WHERE razon_social LIKE $1) AS empresas,
           (SELECT COUNT(*) FROM pos.producto
            WHERE sku = $2) AS productos`,
        [`${marker}%`, sku]
      );

      assert.equal(Number(remaining.rows[0].empresas), 0);
      assert.equal(Number(remaining.rows[0].productos), 0);

      console.log("[OK] Limpieza de datos sintéticos verificada");
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      process.exitCode = 1;
      console.error("[ERROR] Limpieza:", error.message);
      console.error("Marcador para revisión:", marker);
    } finally {
      await db.end().catch(() => {});
    }
  }
}
