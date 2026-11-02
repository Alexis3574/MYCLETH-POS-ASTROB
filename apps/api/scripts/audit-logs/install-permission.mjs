import "dotenv/config";
import pg from "pg";

const args = process.argv.slice(2);

if (args.some(arg => arg !== "--apply") || args.length > 1) {
  throw new Error("Uso: node.exe install-permission.mjs [--apply]");
}

const apply = args.includes("--apply");

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL no definida.");
}

const database = decodeURIComponent(
  new URL(url).pathname.replace(/^\/+/, "")
);

if (database !== "pos_novnix") {
  throw new Error(
    "Instalacion rechazada: solo se permite pos_novnix."
  );
}

const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 10000,
  query_timeout: 20000
});

const permissionCode = "AUDITORIA.VER";
const permissionModule = "AUDITORIA";

let transactionActive = false;

try {
  await client.connect();

  await client.query(
    apply ? "BEGIN" : "BEGIN TRANSACTION READ ONLY"
  );

  transactionActive = true;

  await client.query("SET LOCAL lock_timeout = '5s'");

  const identity = await client.query(`
    SELECT
      current_database() AS database,
      current_user AS username
  `);

  if (identity.rows[0]?.database !== "pos_novnix") {
    throw new Error("Base de datos inesperada.");
  }

  const roleResult = await client.query(`
    SELECT id, codigo, activo
    FROM pos.rol
    WHERE codigo = $1
  `, ["ADMIN"]);

  const role = roleResult.rows[0];

  if (!role || !role.activo) {
    throw new Error("No existe un rol ADMIN activo.");
  }

  let permissionResult = await client.query(`
    SELECT id, codigo, modulo
    FROM pos.permiso
    WHERE codigo = $1
  `, [permissionCode]);

  let permission = permissionResult.rows[0];

  if (
    permission &&
    permission.modulo !== permissionModule
  ) {
    throw new Error(
      "El permiso existe con un modulo diferente."
    );
  }

  let alreadyAssigned = false;

  if (permission) {
    const assignment = await client.query(`
      SELECT 1
      FROM pos.rol_permiso
      WHERE rol_id = $1
        AND permiso_id = $2
    `, [role.id, permission.id]);

    alreadyAssigned = assignment.rowCount > 0;
  }

  console.log("\n=== ESTADO DE PERMISOS M14 ===");

  console.table([{
    database: identity.rows[0].database,
    modo: apply ? "APLICAR" : "SOLO_LECTURA",
    permiso: permissionCode,
    existe: Boolean(permission),
    rol: role.codigo,
    asignado: alreadyAssigned
  }]);

  if (!apply) {
    console.log(
      "\nSIMULACION COMPLETADA: ningun dato fue modificado."
    );

    await client.query("ROLLBACK");
    transactionActive = false;
  } else {
    await client.query(`
      INSERT INTO pos.permiso (
        codigo,
        modulo,
        descripcion
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (codigo) DO NOTHING
    `, [
      permissionCode,
      permissionModule,
      "Consultar registros de auditoria autorizados."
    ]);

    permissionResult = await client.query(`
      SELECT id, codigo, modulo
      FROM pos.permiso
      WHERE codigo = $1
    `, [permissionCode]);

    permission = permissionResult.rows[0];

    if (
      !permission ||
      permission.modulo !== permissionModule
    ) {
      throw new Error(
        "No fue posible verificar el permiso."
      );
    }

    await client.query(`
      INSERT INTO pos.rol_permiso (
        rol_id,
        permiso_id
      )
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [role.id, permission.id]);

    const verification = await client.query(`
      SELECT 1
      FROM pos.rol_permiso
      WHERE rol_id = $1
        AND permiso_id = $2
    `, [role.id, permission.id]);

    if (verification.rowCount !== 1) {
      throw new Error(
        "No se verifico la asignacion al rol ADMIN."
      );
    }

    await client.query("COMMIT");
    transactionActive = false;

    console.log("\nPERMISO INSTALADO Y VERIFICADO.");
    console.log({
      codigo: permission.codigo,
      modulo: permission.modulo,
      rol: role.codigo
    });
  }
} catch (error) {
  if (transactionActive) {
    await client.query("ROLLBACK").catch(() => {});
  }

  console.error("ERROR M14:", error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
