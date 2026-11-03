import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
export function guard({write=false}={}) {
  const u=new URL(process.env.DATABASE_URL||'postgres://invalid/invalid');
  assert.ok(['postgres:','postgresql:'].includes(u.protocol));
  assert.ok(['localhost','127.0.0.1'].includes(u.hostname));
  assert.ok(!u.port||u.port==='5432');
  assert.equal(decodeURIComponent(u.pathname),'/pos_novnix');
  assert.ok(!u.searchParams.has('host'));
  assert.ok(!u.searchParams.has('schema')||u.searchParams.get('schema')==='pos');
  assert.notEqual(process.env.NODE_ENV,'production');
  assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'devalex');
  assert.equal(process.env.INVENTORY_SYNC_ENABLED,'false');
  if(write) {
    assert.equal(process.env.POS_INTEGRAL_ALLOW_WRITES,'SI');
    assert.equal(process.env.POS_INTEGRAL_WORKERS_STOPPED,'SI');
    assert.equal(process.env.POS_ALLOW_TEST_DB,'SI');
  }
  return u;
}
export function dateInZone(timezone='America/Mexico_City') {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=k=>parts.find(v=>v.type===k)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export async function localApp() {
  const [{app},{prisma},{tokenService}]=await Promise.all([
    import('../../src/app.ts'),import('../../src/lib/prisma.ts'),import('../../src/modules/auth/token.service.ts')]);
  const {once}=await import('node:events');
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  return {prisma,tokenService,base:`http://127.0.0.1:${server.address().port}`,
    async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await prisma.$disconnect();}};
}
export async function http(base,path,token) {
  const response=await fetch(base+path,{headers:token?{Authorization:`Bearer ${token}`}:{},signal:AbortSignal.timeout(15000)});
  const body=await response.json().catch(()=>null);
  return {status:response.status,body};
}
