import dotenv from "dotenv";
import pg from "pg";
import { hash } from "bcryptjs";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

dotenv.config({ quiet: true });

const dbUrl = new URL(process.env.DATABASE_URL);
const apiUrl = new URL(
  process.env.POS_HTTP_URL || "http://127.0.0.1:3000"
);

if (
  !["localhost", "127.0.0.1"].includes(dbUrl.hostname) ||
  (dbUrl.port && dbUrl.port !== "5432") ||
  dbUrl.pathname !== "/pos_novnix" ||
  !["localhost", "127.0.0.1"].includes(apiUrl.hostname) ||
  apiUrl.protocol !== "http:"
) {
  throw new Error("Entorno local de pruebas no autorizado.");
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const marker = `POS_HTTP_TEST_${suffix}`;
const username = `http_test_${suffix}`;
const password = randomBytes(24).toString("base64url");

let companyId = null;
let userId = null;

try {
  await client.connect();

  const db = await client.query(
    "SELECT current_database() AS nombre"
  );

  assert.equal(db.rows[0].nombre, "pos_novnix");

  console.log("[OK] PostgreSQL: pos_novnix");

  const passwordHash = await hash(password, 10);

  await client.query("BEGIN");

  try {
    const company = await client.query(
      `INSERT INTO pos.empresa
       (razon_social, nombre_comercial)
       VALUES ($1, $1)
       RETURNING id`,
      [marker]
    );

    companyId = company.rows[0].id;

    const user = await client.query(
      `INSERT INTO pos.usuario
       (empresa_id, username, password_hash, nombre)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [companyId, username, passwordHash, "Prueba HTTP"]
    );

    userId = user.rows[0].id;

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    companyId = null;
    userId = null;
    throw error;
  }

  console.log("[OK] Identidad sintética creada");

  const loginResponse = await fetch(
    new URL("/api/v1/auth/login", apiUrl),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empresa_id: String(companyId),
        username,
        password,
      }),
      signal: AbortSignal.timeout(15000),
    }
  );

  assert.equal(
    loginResponse.status,
    200,
    `Login HTTP: ${loginResponse.status}`
  );

  const login = await loginResponse.json();
  const token = login.data?.access_token;

  assert.ok(token, "No se recibió JWT");

  console.log("[OK] Login HTTP 200 y JWT recibido");

  const meResponse = await fetch(
    new URL("/api/v1/auth/me", apiUrl),
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15000),
    }
  );

  assert.equal(meResponse.status, 200);

  const me = await meResponse.json();

  assert.equal(me.data?.id, String(userId));
  assert.equal(me.data?.empresa?.id, String(companyId));

  console.log("[OK] GET /auth/me: HTTP 200");
  console.log("[OK] Usuario y empresa coinciden");
  console.log("[OK] Express utiliza la base de pruebas autorizada");

} catch (error) {
  process.exitCode = 1;

  console.error(
    "[ERROR]",
    error instanceof Error ? error.message : String(error)
  );
} finally {
  try {
    if (userId !== null) {
      await client.query(
        "DELETE FROM pos.usuario WHERE id = $1",
        [userId]
      );
    }

    if (companyId !== null) {
      await client.query(
        "DELETE FROM pos.empresa WHERE id = $1 AND razon_social = $2",
        [companyId, marker]
      );
    }

    if (companyId !== null) {
      console.log("[OK] Identidad sintética eliminada");
    }
  } catch (error) {
    process.exitCode = 1;
    console.error("[ERROR] Limpieza incompleta:", error.message);
  } finally {
    await client.end().catch(() => {});
  }
}
