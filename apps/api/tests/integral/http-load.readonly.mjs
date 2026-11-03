/** Low-concurrency HTTP read-only smoke test; NOT a full production load test. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';

const url = new URL(process.env.DATABASE_URL || 'postgres://invalid/invalid');
assert.ok(['postgres:','postgresql:'].includes(url.protocol));
assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
assert.ok(!url.port || url.port === '5432');
assert.equal(decodeURIComponent(url.pathname),'/pos_novnix');
assert.ok(!url.searchParams.has('host'));
const { app } = await import('../../src/app.ts');
const { prisma } = await import('../../src/lib/prisma.ts');
const { tokenService } = await import('../../src/modules/auth/token.service.ts');
let server;
try {
  const identity = await prisma.$queryRaw`SELECT current_database() AS db`;
  assert.equal(identity[0]?.db,'pos_novnix');
  const actor = await prisma.usuario.findFirst({
    where: {
      activo: true, bloqueado: false, empresa: {activo:true},
      usuario_rol: {some: {rol: {codigo:'ADMIN', activo:true}}}
    },
    select: {id:true, empresa_id:true}
  });
  assert.ok(actor,'No hay ADMIN activo para benchmark HTTP');
  const token = await tokenService.createAccessToken({userId:actor.id,empresaId:actor.empresa_id});
  server = app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const port = server.address().port;
  const endpoints = [
    '/api/v1/reports/ventas?fecha_desde=2026-09-25&fecha_hasta=2026-10-03&limit=20',
    '/api/v1/reports/inventario?fecha_desde=2026-09-25&fecha_hasta=2026-10-03&limit=20',
    '/api/v1/dashboard/summary?fecha_desde=2026-09-25&fecha_hasta=2026-10-03',
  ];
  const n = Math.min(60,Math.max(12,Number(process.env.POS_INTEGRAL_HTTP_REQUESTS || 30) || 30));
  const durations = [];
  let completed = 0;
  let index = 0;
  async function worker() {
    for(;;) {
      const current = index++;
      if(current >= n) return;
      const t = performance.now();
      const r = await fetch(`http://127.0.0.1:${port}${endpoints[current%endpoints.length]}`,{
        headers: {Authorization:`Bearer ${token}`}, signal:AbortSignal.timeout(15000)
      });
      const result = await r.json();
      assert.equal(r.status,200,JSON.stringify(result).slice(0,500));
      assert.equal(result.ok,true);
      durations.push(performance.now()-t);
      completed++;
    }
  }
  await Promise.all(Array.from({length:3},()=>worker()));
  durations.sort((a,b)=>a-b);
  const pct = x => Number(durations[Math.ceil(x*durations.length)-1].toFixed(1));
  console.log(JSON.stringify({mode:'READ_ONLY_LOW_LOAD',requests:completed,concurrency:3,p50_ms:pct(.5),p95_ms:pct(.95),p99_ms:pct(.99),max_ms:pct(1),threshold:'NO DEFINIDO',production_sla_validated:false},null,2));
} finally {
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await prisma.$disconnect();
}
