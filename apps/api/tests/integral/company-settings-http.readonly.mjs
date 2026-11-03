/** M15: only GET and non-mutating authorization cases. Never PUT. */
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

const url = new URL(process.env.DATABASE_URL ?? 'postgres://invalid/invalid');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.ok(!url.port || url.port === '5432');
assert.equal(decodeURIComponent(url.pathname), '/pos_novnix');
assert.ok(!url.searchParams.has('host'));

// Fail closed: the orchestrator must give this process a read-only DB connection.
assert.match(url.searchParams.get('options') ?? '', /(?:^|\s)-c\s+default_transaction_read_only=on(?:\s|$)/);

test('M15: HTTP configuración empresarial ESTRICTAMENTE solo lectura', async t => {
  const { app } = await import('../../src/app.ts');
  const { prisma } = await import('../../src/lib/prisma.ts');
  const { tokenService } = await import('../../src/modules/auth/token.service.ts');
  const { settingKeys } = await import('../../src/modules/company-settings/company-settings.schema.ts');
  let server;
  try {
    const check = await prisma.$queryRaw`
      SELECT current_database() AS db, current_setting('transaction_read_only') AS readonly
    `;
    assert.equal(check[0]?.db, 'pos_novnix');
    assert.equal(check[0]?.readonly, 'on');
    const admin = await prisma.usuario.findFirst({
      where: {activo:true,bloqueado:false,empresa:{activo:true},usuario_rol:{some:{rol:{codigo:'ADMIN',activo:true,rol_permiso:{some:{permiso:{codigo:'CONFIGURACION.GESTIONAR'}}}}}}},
      select:{id:true,empresa_id:true}
    });
    assert.ok(admin, 'Se requiere ADMIN con CONFIGURACION.GESTIONAR');
    const token = await tokenService.createAccessToken({userId:admin.id,empresaId:admin.empresa_id});
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/v1/company-settings`;
    async function request(suffix='', bearer=token) {
      const response = await fetch(base+suffix,{headers:bearer ? {Authorization:`Bearer ${bearer}`} : {}, signal:AbortSignal.timeout(10000)});
      return {status:response.status,body:await response.json()};
    }
    await t.test('Sin JWT devuelve 401',async()=>assert.equal((await request('',null)).status,401));
    await t.test('JWT invalido devuelve 401',async()=>assert.equal((await request('','no.es.jwt')).status,401));
    await t.test('Empresa manipulada devuelve 401',async()=>{
      const forged = await tokenService.createAccessToken({userId:admin.id,empresaId:0n});
      assert.equal((await request('',forged)).status,401);
    });
    await t.test('Listado M15 GET solo lectura',async()=>{
      const response=await request();
      assert.equal(response.status,200,JSON.stringify(response.body));
      assert.equal(response.body?.ok,true);
      assert.deepEqual(response.body.data.map(x=>x.clave),[...settingKeys]);
      for(const row of response.body.data) {
        assert.equal(typeof row.personalizado,'boolean');
        assert.ok(row.valor && typeof row.valor==='object');
      }
    });
    await t.test('Categorias GET individuales',async()=>{
      for(const key of settingKeys){
        const response=await request(`/${key}`);
        assert.equal(response.status,200,`Categoria ${key}`);
        assert.equal(response.body?.data?.clave,key);
      }
    });
    await t.test('Categoria desconocida GET devuelve 400',async()=>assert.equal((await request('/categoria_desconocida')).status,400));
    await t.test('Usuario sin CONFIGURACION.GESTIONAR bloqueado',async st=>{
      const denied=await prisma.usuario.findFirst({
        where:{empresa_id:admin.empresa_id,activo:true,bloqueado:false,usuario_rol:{none:{rol:{activo:true,rol_permiso:{some:{permiso:{codigo:'CONFIGURACION.GESTIONAR'}}}}}}},
        select:{id:true,empresa_id:true}
      });
      if(!denied){st.skip('Sin usuario real con ese perfil');return;}
      const deniedToken=await tokenService.createAccessToken({userId:denied.id,empresaId:denied.empresa_id});
      assert.equal((await request('',deniedToken)).status,403);
    });
    console.log('M15 READONLY: GET verificados; nunca se ejecutó PUT.');
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    await prisma.$disconnect();
  }
});
