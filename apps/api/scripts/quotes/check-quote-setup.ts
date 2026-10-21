import { readFileSync } from 'node:fs';
import { prisma } from '../../src/lib/prisma.js';
async function main() {
  const app = readFileSync('src/app.ts', 'utf8');
  if (!app.includes('app.use("/api/v1/quotes", quoteRouter);')) throw new Error('Router no registrado.');
  const names = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = 'pos' AND table_name IN ('cotizacion', 'cotizacion_detalle')
  `;
  if (names.length !== 2) throw new Error('Faltan tablas de Cotizaciones.');
  const permits = await prisma.permiso.findMany({ where: { codigo: { in: ['COTIZACIONES.VER', 'COTIZACIONES.CREAR'] } }, select: { codigo: true } });
  if (permits.length !== 2) throw new Error('Faltan permisos existentes de Cotizaciones.');
  console.log('[OK] Ruta, tablas y permisos existentes confirmados.');
}
main().catch(e => { console.error('[ERROR]', e); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
