import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ quiet: true });

test("Cajas: PostgreSQL, restricciones y rollback", async () => {
  const connection = process.env.DATABASE_URL;

  assert.ok(connection, "DATABASE_URL no configurada");

  const url = new URL(connection);

  assert.ok(
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    (!url.port || url.port === "5432") &&
    url.pathname === "/pos_novnix",
    "La base debe ser pos_novnix local"
  );

  const db = new pg.Client({
    connectionString: connection,
  });

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const marker = `CASH_TEST_${suffix}`;

  let started = false;
  let checks = 0;

  function passed(message) {
    checks++;
    console.log(`[OK] ${message}`);
  }

  async function insert(sql, values) {
    const result = await db.query(sql, values);
    return result.rows[0].id;
  }

  async function expectUnique(sql, values, savepoint) {
    await db.query(`SAVEPOINT ${savepoint}`);

    let errorCode = null;

    try {
      await db.query(sql, values);
    } catch (error) {
      errorCode = error.code;
    }

    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await db.query(`RELEASE SAVEPOINT ${savepoint}`);

    assert.equal(errorCode, "23505");
  }

  try {
    await db.connect();

    const database = await db.query(
      "SELECT current_database() AS nombre"
    );

    assert.equal(database.rows[0].nombre, "pos_novnix");
    passed("Conexión PostgreSQL autorizada");

    await db.query("BEGIN");
    started = true;

    const companyId = await insert(
      `INSERT INTO pos.empresa
       (razon_social, nombre_comercial)
       VALUES ($1, $1)
       RETURNING id`,
      [marker]
    );

    const foreignCompanyId = await insert(
      `INSERT INTO pos.empresa
       (razon_social, nombre_comercial)
       VALUES ($1, $1)
       RETURNING id`,
      [`${marker}_FOREIGN`]
    );

    const branchId = await insert(
      `INSERT INTO pos.sucursal
       (empresa_id, codigo, nombre)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [companyId, `BR_${suffix}`, "Sucursal temporal"]
    );

    const userId = await insert(
      `INSERT INTO pos.usuario
       (empresa_id, username, password_hash, nombre)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        companyId,
        `cash_test_${suffix}`,
        "TEST_ONLY_NOT_FOR_LOGIN",
        "Usuario de integración"
      ]
    );

    const cashId = await insert(
      `INSERT INTO pos.caja
       (sucursal_id, codigo, nombre)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [branchId, `CJ_${suffix}`, "Caja de integración"]
    );

    passed("Empresa, sucursal, usuario y caja creados");

    await expectUnique(
      `INSERT INTO pos.caja
       (sucursal_id, codigo, nombre)
       VALUES ($1, $2, $3)`,
      [branchId, `CJ_${suffix}`, "Caja duplicada"],
      "duplicate_cash"
    );

    passed("Código duplicado de caja rechazado");

    const sessionId = await insert(
      `INSERT INTO pos.sesion_caja
       (caja_id, usuario_apertura_id, monto_apertura)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [cashId, userId, "100.00"]
    );

    const opened = await db.query(
      `SELECT estado, monto_apertura
       FROM pos.sesion_caja WHERE id = $1`,
      [sessionId]
    );

    assert.equal(opened.rows[0].estado, "ABIERTA");
    assert.equal(Number(opened.rows[0].monto_apertura), 100);

    passed("Sesión abierta correctamente");

    await expectUnique(
      `INSERT INTO pos.sesion_caja
       (caja_id, usuario_apertura_id, monto_apertura)
       VALUES ($1, $2, $3)`,
      [cashId, userId, "50.00"],
      "duplicate_open_session"
    );

    passed("Segunda apertura simultánea rechazada");

    await db.query(
      `INSERT INTO pos.movimiento_caja
       (sesion_caja_id, usuario_id, tipo,
        concepto, monto, referencia)
       VALUES ($1, $2, 'ENTRADA',
               'Ingreso de prueba', $3, $4)`,
      [sessionId, userId, "30.00", `MANUAL:IN_${suffix}`]
    );

    await db.query(
      `INSERT INTO pos.movimiento_caja
       (sesion_caja_id, usuario_id, tipo,
        concepto, monto, referencia)
       VALUES ($1, $2, 'SALIDA',
               'Retiro de prueba', $3, $4)`,
      [sessionId, userId, "20.00", `MANUAL:OUT_${suffix}`]
    );

    const balance = await db.query(
      `SELECT
         s.monto_apertura +
         COALESCE(SUM(
           CASE
             WHEN m.tipo = 'ENTRADA' THEN m.monto
             WHEN m.tipo = 'SALIDA' THEN -m.monto
             ELSE 0
           END
         ), 0) AS esperado
       FROM pos.sesion_caja s
       LEFT JOIN pos.movimiento_caja m
         ON m.sesion_caja_id = s.id
       WHERE s.id = $1
       GROUP BY s.id, s.monto_apertura`,
      [sessionId]
    );

    const expected = Number(balance.rows[0].esperado);
    assert.equal(expected, 110);

    passed("Movimientos y saldo esperado: 110.00");

    const closed = await db.query(
      `UPDATE pos.sesion_caja
       SET estado = 'CERRADA',
           fecha_cierre = NOW(),
           usuario_cierre_id = $2,
           monto_esperado = $3,
           monto_cierre = $4,
           diferencia = $5
       WHERE id = $1
       RETURNING estado, monto_esperado,
                 monto_cierre, diferencia`,
      [sessionId, userId, "110.00", "109.00", "-1.00"]
    );

    assert.equal(closed.rows[0].estado, "CERRADA");
    assert.equal(Number(closed.rows[0].monto_esperado), 110);
    assert.equal(Number(closed.rows[0].monto_cierre), 109);
    assert.equal(Number(closed.rows[0].diferencia), -1);

    passed("Cierre y diferencia monetaria registrados");

    const reopenedId = await insert(
      `INSERT INTO pos.sesion_caja
       (caja_id, usuario_apertura_id, monto_apertura)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [cashId, userId, "50.00"]
    );

    assert.ok(reopenedId);

    const active = await db.query(
      `SELECT COUNT(*)::int AS total
       FROM pos.sesion_caja
       WHERE caja_id = $1 AND estado = 'ABIERTA'`,
      [cashId]
    );

    assert.equal(active.rows[0].total, 1);

    passed("Nueva sesión permitida después del cierre");

    const foreign = await db.query(
      `SELECT COUNT(*)::int AS total
       FROM pos.caja c
       JOIN pos.sucursal s ON s.id = c.sucursal_id
       WHERE c.id = $1 AND s.empresa_id = $2`,
      [cashId, foreignCompanyId]
    );

    assert.equal(foreign.rows[0].total, 0);

    passed("Consulta filtrada por empresa excluye caja ajena");

  } finally {
    if (started) {
      try {
        await db.query("ROLLBACK");

        const remaining = await db.query(
          `SELECT COUNT(*)::int AS total
           FROM pos.empresa
           WHERE razon_social LIKE $1`,
          [`${marker}%`]
        );

        assert.equal(remaining.rows[0].total, 0);
        passed("Rollback verificado: datos sintéticos eliminados");
      } finally {
        await db.end().catch(() => {});
      }
    } else {
      await db.end().catch(() => {});
    }
  }

  console.log(`\n${checks} comprobaciones PostgreSQL aprobadas.`);
});
