import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ quiet: true });

test("Clientes: integración PostgreSQL y rollback", async () => {
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

  const tag = `CLIENT_TEST_${randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;

  let connected = false;
  let inTransaction = false;
  let checks = 0;
  let savepoints = 0;

  function passed(message) {
    checks++;
    console.log(`[OK] ${message}`);
  }

  async function insert(sql, params) {
    const result = await db.query(sql, params);
    return result.rows[0].id;
  }

  async function expectSqlState(sql, params, expected, label) {
    const name = `test_sp_${++savepoints}`;
    await db.query(`SAVEPOINT ${name}`);

    let actual = null;

    try {
      await db.query(sql, params);
    } catch (error) {
      actual = error.code;
    } finally {
      await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
      await db.query(`RELEASE SAVEPOINT ${name}`);
    }

    assert.equal(actual, expected, label);
    passed(label);
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
    inTransaction = true;

    const companyId = await insert(
      `INSERT INTO pos.empresa
       (razon_social, nombre_comercial)
       VALUES ($1, $1)
       RETURNING id`,
      [tag]
    );

    const foreignCompanyId = await insert(
      `INSERT INTO pos.empresa
       (razon_social, nombre_comercial)
       VALUES ($1, $1)
       RETURNING id`,
      [`${tag}_FOREIGN`]
    );

    passed("Dos empresas sintéticas creadas");

    const customerId = await insert(
      `INSERT INTO pos.cliente
       (empresa_id, codigo, nombre)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [companyId, tag, "Cliente de integración"]
    );

    const defaults = await db.query(
      `SELECT activo, limite_credito, dias_credito
       FROM pos.cliente
       WHERE id = $1`,
      [customerId]
    );

    assert.equal(defaults.rows[0].activo, true);
    assert.equal(Number(defaults.rows[0].limite_credito), 0);
    assert.equal(defaults.rows[0].dias_credito, 0);

    passed("Cliente creado y valores predeterminados validados");

    const foreignCustomerId = await insert(
      `INSERT INTO pos.cliente
       (empresa_id, codigo, nombre)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [foreignCompanyId, tag, "Cliente empresa externa"]
    );

    const scoped = await db.query(
      `SELECT id
       FROM pos.cliente
       WHERE empresa_id = $1 AND codigo = $2`,
      [companyId, tag]
    );

    assert.equal(scoped.rowCount, 1);
    assert.equal(scoped.rows[0].id, customerId);

    passed("Mismo código permitido en empresas diferentes");

    await expectSqlState(
      `INSERT INTO pos.cliente
       (empresa_id, codigo, nombre)
       VALUES ($1, $2, $3)`,
      [companyId, tag, "Cliente duplicado"],
      "23505",
      "Código duplicado rechazado en la misma empresa"
    );

    for (const tipo of ["FISCAL", "ENVIO", "OTRA"]) {
      await db.query(
        `INSERT INTO pos.cliente_direccion
         (cliente_id, tipo, calle, pais, es_principal)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          customerId,
          tipo,
          `Calle ${tipo}`,
          "México",
          tipo === "FISCAL",
        ]
      );
    }

    const addresses = await db.query(
      `SELECT tipo, es_principal
       FROM pos.cliente_direccion
       WHERE cliente_id = $1
       ORDER BY id`,
      [customerId]
    );

    assert.deepEqual(
      addresses.rows.map(row => row.tipo),
      ["FISCAL", "ENVIO", "OTRA"]
    );

    assert.equal(
      addresses.rows.filter(row => row.es_principal).length,
      1
    );

    passed("Tres tipos de dirección permitidos");

    await expectSqlState(
      `INSERT INTO pos.cliente_direccion
       (cliente_id, tipo, pais)
       VALUES ($1, $2, $3)`,
      [customerId, "INVALIDO", "México"],
      "23514",
      "Tipo de dirección no permitido rechazado"
    );

    await expectSqlState(
      `INSERT INTO pos.cliente_direccion
       (cliente_id, tipo, pais)
       VALUES ($1, $2, $3)`,
      ["9223372036854775807", "FISCAL", "México"],
      "23503",
      "Dirección sin cliente válido rechazada"
    );

    const updated = await db.query(
      `UPDATE pos.cliente
       SET nombre = $2,
           limite_credito = $3,
           dias_credito = $4
       WHERE id = $1
       RETURNING nombre, limite_credito, dias_credito`,
      [
        customerId,
        "Cliente actualizado",
        "450.50",
        30,
      ]
    );

    assert.equal(
      updated.rows[0].nombre,
      "Cliente actualizado"
    );

    assert.equal(
      Number(updated.rows[0].limite_credito),
      450.50
    );

    assert.equal(updated.rows[0].dias_credito, 30);

    passed("Actualización de crédito y datos persistida");

    await db.query(
      "DELETE FROM pos.cliente WHERE id = $1",
      [customerId]
    );

    const remainingAddresses = await db.query(
      `SELECT COUNT(*)::int AS total
       FROM pos.cliente_direccion
       WHERE cliente_id = $1`,
      [customerId]
    );

    assert.equal(remainingAddresses.rows[0].total, 0);

    passed("Eliminación en cascada de direcciones comprobada");

    const foreignStillExists = await db.query(
      `SELECT COUNT(*)::int AS total
       FROM pos.cliente
       WHERE id = $1 AND empresa_id = $2`,
      [foreignCustomerId, foreignCompanyId]
    );

    assert.equal(foreignStillExists.rows[0].total, 1);

    passed("Cliente de la otra empresa permanece intacto");

    await db.query("ROLLBACK");
    inTransaction = false;

    const remaining = await db.query(
      `SELECT
         (SELECT COUNT(*)::int
          FROM pos.empresa
          WHERE razon_social LIKE $1) AS empresas,
         (SELECT COUNT(*)::int
          FROM pos.cliente
          WHERE codigo = $2) AS clientes`,
      [`${tag}%`, tag]
    );

    assert.equal(remaining.rows[0].empresas, 0);
    assert.equal(remaining.rows[0].clientes, 0);

    passed("Rollback verificado: sin registros sintéticos");

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
