import "dotenv/config";
import { prisma } from "../../src/lib/prisma.js";

const code = "ECOMMERCE_SYNC.REINTENTAR";
const moduleName = "ECOMMERCE_SYNC";
const mode = process.argv[2];

async function main() {
  if (!["--check", "--apply"].includes(mode ?? "")) {
    throw new Error("Modo requerido: --check o --apply");
  }

  const url = new URL(process.env.DATABASE_URL ?? "");

  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    decodeURIComponent(url.pathname) !== "/pos_novnix" ||
    (url.port && url.port !== "5432") ||
    url.searchParams.has("host") ||
    url.searchParams.get("schema") !== "pos" ||
    process.env.NODE_ENV === "production"
  ) {
    throw new Error("Destino PostgreSQL no autorizado.");
  }

  const existing = await prisma.permiso.findUnique({
    where: { codigo: code }
  });

  if (existing && existing.modulo !== moduleName) {
    throw new Error("Conflicto con un permiso existente.");
  }

  if (mode === "--check") {
    console.log(JSON.stringify({
      ok: true,
      modo: mode,
      existe: Boolean(existing),
      id: existing?.id.toString() ?? null,
      escrituras: 0
    }, null, 2));
    return;
  }

  const result = await prisma.permiso.upsert({
    where: { codigo: code },
    update: {},
    create: {
      codigo: code,
      modulo: moduleName,
      descripcion:
        "Autorizar el reintento manual de eventos Ecommerce agotados"
    }
  });

  const assignments = await prisma.rol_permiso.count({
    where: { permiso_id: result.id }
  });

  console.log(JSON.stringify({
    ok: true,
    id: result.id.toString(),
    codigo: result.codigo,
    asignaciones_roles: assignments
  }, null, 2));
}

main()
  .catch(error => {
    console.error("ERROR:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
