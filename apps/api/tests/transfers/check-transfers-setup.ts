import "dotenv/config";
import { prisma } from "../../src/lib/prisma.js";
import assert from "node:assert/strict";

async function main() {
  const rows = await prisma.$queryRaw<Array<{ operaciones: string | null; procedimiento: string | null; detalle_trigger: boolean; stock_trigger: boolean }>>`
    SELECT to_regclass('pos.operacion_transferencia')::text AS operaciones,
      to_regprocedure('pos.sp_completar_transferencia(bigint,bigint)')::text AS procedimiento,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid = 'pos.transferencia_detalle'::regclass
        AND tgname = 'trg_transferencia_detalle_editable' AND tgenabled IN ('O', 'A')) AS detalle_trigger,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid = 'pos.movimiento_inventario'::regclass
        AND tgname = 'trg_movimiento_inventario_aplicar' AND tgenabled IN ('O', 'A')) AS stock_trigger
  `;
  assert.ok(rows[0]?.operaciones);
  assert.ok(rows[0]?.procedimiento);
  assert.equal(rows[0]?.detalle_trigger, true);
  assert.equal(rows[0]?.stock_trigger, true);
  const permission = await prisma.permiso.findUnique({ where: { codigo: "INVENTARIO.TRANSFERIR" } });
  assert.ok(permission);
  console.log({ ok: true, permiso_id: permission.id.toString(), alcance: "Comprobación de instalación; no valida operaciones ni sincronización real." });
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
