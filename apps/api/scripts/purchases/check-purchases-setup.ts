import 'dotenv/config';
import { prisma } from '../../src/lib/prisma.js';
async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const rows = await tx.$queryRaw<Array<{ db: string; port: number | null; operation_table: boolean }>>`
      SELECT current_database() AS db, inet_server_port() AS port,
             to_regclass('pos.operacion_compra') IS NOT NULL AS operation_table
    `;
    console.log(rows);
    if (rows[0]?.db !== 'pos_novnix' || rows[0]?.port !== 5432) throw new Error('Base/puerto no autorizados.');
    if (!rows[0]?.operation_table) throw new Error('Falta migración pos.operacion_compra.');
    const permissions = await tx.permiso.findMany({ where: { codigo: { in: ['COMPRAS.VER', 'COMPRAS.CREAR', 'COMPRAS.CANCELAR'] } }, select: { codigo: true } });
    console.log('Permisos:', permissions.map((item) => item.codigo));
    if (permissions.length !== 3) throw new Error('Faltan permisos existentes de Compras.');
    const procedures = await tx.$queryRaw<Array<{ receive: boolean; cancel: boolean; trigger: boolean }>>`
      SELECT
        to_regprocedure('pos.sp_recibir_compra(bigint,bigint)') IS NOT NULL AS receive,
        to_regprocedure('pos.sp_cancelar_compra(bigint,bigint,text)') IS NOT NULL AS cancel,
        EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_movimiento_inventario_aplicar'
                AND tgrelid = 'pos.movimiento_inventario'::regclass AND tgenabled IN ('O','A')) AS trigger
    `;
    console.log(procedures);
    if (!procedures[0]?.receive || !procedures[0]?.cancel || !procedures[0]?.trigger) throw new Error('Funciones o trigger faltantes.');
  });
  console.log('[OK] Precondiciones de Compras comprobadas sin modificaciones.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
