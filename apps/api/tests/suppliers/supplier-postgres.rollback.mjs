import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ quiet: true });

test("Proveedores: PostgreSQL y rollback", async () => {
  const connection = process.env.DATABASE_URL;
  assert.ok(connection, "DATABASE_URL no configurada");

  const url = new URL(connection);
  assert.ok(
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    (!url.port || url.port === "5432") &&
    url.pathname === "/pos_novnix",
    "Solo se permite pos_novnix local"
  );

  const db = new pg.Client({
    connectionString: connection,
    connectionTimeoutMillis: 5000,
  });

  const tag = `PR_TEST_${randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;

  let connected = false;
  let inTransaction = false;
  let checks = 0;
  let savepoints = 0;

  function passed(label) {
    checks++;
    console.log(`[OK] ${label}`);
  }

  async function insert(sql, params) {
    const result = await db.query(sql, params);
    return result.rows[0].id;
  }

  async function expectSqlState(sql, params, expected, label) {
    const savepoint = `supplier_sp_${++savepoints}`;
    await db.query(`SAVEPOINT ${savepoint}`);

    let actual = null;
    try {
      await db.query(sql, params);
    } catch (error) {
      actual = error.code;
    } finally {
      await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await db.query(`RELEASE SAVEPOINT ${savepoint}`);
    }

    assert.equal(actual, expected, label);
    passed(label);
  }

  try {
    await db.connect();
    connected = true;

    const current = await db.query(
      "SELECT current_database() AS nombre"
    );

    assert.equal(current.rows[0].nombre, "pos_novnix");
    passed("Conexión PostgreSQL autorizada");

    await db.query("BEGIN");
    inTransaction = true;

    const companyId = await insert(
      `INSERT INTO pos.empresa
       (razon_social, nombre_comercial)
       VALUES ($1, $1) RETURNING id`,
      [tag]
    );

    const foreignCompanyId = await insert(
      `INSERT INTO pos.empresa
       (razon_social, nombre_comercial)
       VALUES ($1, $1) RETURNING id`,
      [`${tag}_FOREIGN`]
    );

    passed("Dos empresas sintéticas creadas");

    const supplierId = await insert(
      `INSERT INTO pos.proveedor
       (empresa_id, codigo, razon_social)
       VALUES ($1, $2, $3) RETURNING id`,
      [companyId, tag, "Proveedor temporal"]
    );

    const defaults = await db.query(
      `SELECT activo, dias_credito
       FROM pos.proveedor WHERE id = $1`,
      [supplierId]
    );

    assert.equal(defaults.rows[0].activo, true);
    assert.equal(defaults.rows[0].dias_credito, 0);
    passed("Proveedor creado y valores predeterminados correctos");

    const foreignSupplierId = await insert(
      `INSERT INTO pos.proveedor
       (empresa_id, codigo, razon_social)
       VALUES ($1, $2, $3) RETURNING id`,
      [foreignCompanyId, tag, "Proveedor externo"]
    );

    const scoped = await db.query(
      `SELECT id FROM pos.proveedor
       WHERE empresa_id = $1 AND codigo = $2`,
      [companyId, tag]
    );

    assert.equal(scoped.rowCount, 1);
    assert.equal(scoped.rows[0].id, supplierId);

    passed("Mismo código permitido en distintas empresas");

    await expectSqlState(
      `INSERT INTO pos.proveedor
       (empresa_id, codigo, razon_social)
       VALUES ($1, $2, $3)`,
      [companyId, tag, "Duplicado"],
      "23505",
      "Código duplicado rechazado"
    );

    await expectSqlState(
      `INSERT INTO pos.proveedor
       (empresa_id, codigo, razon_social, dias_credito)
       VALUES ($1, $2, $3, $4)`,
      [companyId, `${tag}_BAD`, "Crédito negativo", -1],
      "23514",
      "Días de crédito negativos rechazados"
    );

    for (const tipo of ["FISCAL", "ENTREGA", "OTRA"]) {
      await db.query(
        `INSERT INTO pos.proveedor_direccion
         (proveedor_id, tipo, pais, es_principal)
         VALUES ($1, $2, $3, $4)`,
        [
          supplierId,
          tipo,
          "México",
          tipo === "FISCAL",
        ]
      );
    }

    const addresses = await db.query(
      `SELECT tipo, es_principal
       FROM pos.proveedor_direccion
       WHERE proveedor_id = $1
       ORDER BY id`,
      [supplierId]
    );

    assert.deepEqual(
      addresses.rows.map(row => row.tipo),
      ["FISCAL", "ENTREGA", "OTRA"]
    );

    assert.equal(
      addresses.rows.filter(row => row.es_principal).length,
      1
    );

    passed("Tres tipos de dirección permitidos");

    await expectSqlState(
      `INSERT INTO pos.proveedor_direccion
       (proveedor_id, tipo, pais)
       VALUES ($1, $2, $3)`,
      [supplierId, "INVALIDO", "México"],
      "23514",
      "Tipo de dirección inválido rechazado"
    );

    await expectSqlState(
      `INSERT INTO pos.proveedor_direccion
       (proveedor_id, tipo, pais)
       VALUES ($1, $2, $3)`,
      ["9223372036854775807", "FISCAL", "México"],
      "23503",
      "Dirección sin proveedor válido rechazada"
    );

    const updated = await db.query(
      `UPDATE pos.proveedor
       SET razon_social = $2,
           dias_credito = $3,
           activo = $4
       WHERE id = $1
       RETURNING razon_social, dias_credito, activo`,
      [supplierId, "Proveedor actualizado", 30, false]
    );

    assert.equal(
      updated.rows[0].razon_social,
      "Proveedor actualizado"
    );

    assert.equal(updated.rows[0].dias_credito, 30);
    assert.equal(updated.rows[0].activo, false);

    passed("Actualización de proveedor persistida");

    await db.query(
      "DELETE FROM pos.proveedor WHERE id = $1",
      [supplierId]
    );

    const remainingAddresses = await db.query(
      `SELECT COUNT(*)::int AS total
       FROM pos.proveedor_direccion
       WHERE proveedor_id = $1`,
      [supplierId]
    );

    assert.equal(remainingAddresses.rows[0].total, 0);

    passed("Eliminación en cascada de direcciones");

    const foreign = await db.query(
      `SELECT COUNT(*)::int AS total
       FROM pos.proveedor
       WHERE id = $1 AND empresa_id = $2`,
      [foreignSupplierId, foreignCompanyId]
    );

    assert.equal(foreign.rows[0].total, 1);
    passed("Proveedor de empresa externa conservado");

    await db.query("ROLLBACK");
    inTransaction = false;

    const remaining = await db.query(
      `SELECT
         (SELECT COUNT(*)::int
          FROM pos.empresa
          WHERE razon_social LIKE $1) AS empresas,
         (SELECT COUNT(*)::int
          FROM pos.proveedor
          WHERE codigo = $2) AS proveedores`,
      [`${tag}%`, tag]
    );

    assert.equal(remaining.rows[0].empresas, 0);
    assert.equal(remaining.rows[0].proveedores, 0);

    passed("Rollback sin registros sintéticos");

    console.log(
      `\n${checks} comprobaciones PostgreSQL aprobadas.`
    );
  } finally {
    if (connected) {
      if (inTransaction) {
        await db.query("ROLLBACK").catch(() => {});
      }
      await db.end().catch(() => {});
    }
  }
});
