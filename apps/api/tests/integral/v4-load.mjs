/** Bounded repeatable HTTP load with explicit, provisional acceptance thresholds. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {guard,localApp,http} from './v4-safety.mjs';
guard();
const num=(k,d,min,max)=>{const x=Number(process.env[k]??d);assert.ok(Number.isInteger(x)&&x>=min&&x<=max,`${k} fuera de rango`);return x;};
const requests=num('POS_V4_LOAD_REQUESTS',500,100,2000);
const concurrency=num('POS_V4_LOAD_CONCURRENCY',12,1,30);
const p95Limit=num('POS_V4_LOAD_P95_MS',2000,1,30000);
const p99Limit=num('POS_V4_LOAD_P99_MS',4000,1,30000);
const {prisma,tokenService,base,close}=await localApp();
try {
  const user=await prisma.usuario.findFirst({where:{activo:true,bloqueado:false,empresa:{activo:true},usuario_rol:{some:{rol:{codigo:'ADMIN',activo:true,rol_permiso:{some:{permiso:{codigo:'REPORTES.VER'}}}}}}},select:{id:true,empresa_id:true}});
  assert.ok(user,'Falta administrador autorizado');
  const token=await tokenService.createAccessToken({userId:user.id,empresaId:user.empresa_id});
  const paths=['/api/v1/reports/ventas?fecha_desde=2026-09-25&fecha_hasta=2026-10-03&limit=20',
    '/api/v1/reports/inventario?fecha_desde=2026-09-25&fecha_hasta=2026-10-03&limit=20',
    '/api/v1/dashboard/summary?fecha_desde=2026-09-25&fecha_hasta=2026-10-03'];
  const durations=[];const errors=[];let next=0;
  const begin=performance.now();
  async function worker(){for(;;){const i=next++;if(i>=requests)return;const t=performance.now();try{const res=await http(base,paths[i%paths.length],token);if(res.status!==200||!res.body?.ok)errors.push({i,status:res.status});}catch(e){errors.push({i,error:e.message});}durations.push(performance.now()-t);}}
  await Promise.all(Array.from({length:concurrency},()=>worker()));
  durations.sort((a,b)=>a-b);
  const q=p=>Number(durations[Math.ceil(p*durations.length)-1].toFixed(1));
  const metrics={requests,concurrency,p50_ms:q(.5),p95_ms:q(.95),p99_ms:q(.99),max_ms:q(1),elapsed_ms:Math.round(performance.now()-begin),errors:errors.length,thresholds:{p95_ms:p95Limit,p99_ms:p99Limit},production_sla_validated:false,notes:'SLO provisional local; requiere dimensionamiento y datos a escala para produccion.'};
  console.log(JSON.stringify(metrics,null,2));
  assert.equal(errors.length,0,JSON.stringify(errors.slice(0,5)));
  assert.ok(metrics.p95_ms<=p95Limit,`P95 excede umbral ${p95Limit}ms`);
  assert.ok(metrics.p99_ms<=p99Limit,`P99 excede umbral ${p99Limit}ms`);
} finally {await close();}
