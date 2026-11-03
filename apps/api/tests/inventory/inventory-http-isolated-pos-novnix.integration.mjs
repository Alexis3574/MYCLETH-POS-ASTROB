/**
 * POSMYCLETH — Inventory isolated HTTP regression, local pos_novnix only.
 *
 * Usage, from apps/api:
 *   INVENTORY_SYNC_ENABLED=false POS_ALLOW_TEST_DB=SI node --import tsx tests/inventory/inventory-http-isolated-pos-novnix.integration.mjs --preflight
 *   INVENTORY_SYNC_ENABLED=false POS_ALLOW_TEST_DB=SI node --import tsx tests/inventory/inventory-http-isolated-pos-novnix.integration.mjs --run
 *   INVENTORY_SYNC_ENABLED=false POS_ALLOW_TEST_DB=SI node --import tsx tests/inventory/inventory-http-isolated-pos-novnix.integration.mjs --cleanup-marker INVH_XXXXXXXXXXXX
 *
 * Read-only preflight; --run creates *only* named synthetic fixtures and
 * exercises Express on 127.0.0.1 with JWT from the application's tokenService.
 * --run cleans in a single scoped transaction. If interrupted, retain marker
 * and use --cleanup-marker only after reviewing it. No Ecommerce network calls.
 * DO NOT execute while another worker/process can handle outbox events.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';

const mode = process.argv[2];
const markerRe = /^INVH_[A-F0-9]{12}$/;
const marker = mode === '--cleanup-marker'
  ? process.argv[3]
  : `INVH_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
const guard = (test, message) => { if (!test) throw new Error(`[INVH SEGURIDAD] ${message}`); };
guard(['--preflight','--run','--cleanup-marker'].includes(mode), 'Modo no admitido.');
guard(process.argv.length === (mode === '--cleanup-marker' ? 4 : 3), 'Argumentos inesperados.');
guard(markerRe.test(marker), 'Marcador no válido.');
guard(process.env.POS_ALLOW_TEST_DB === 'SI', 'Se requiere POS_ALLOW_TEST_DB=SI.');
guard(process.env.INVENTORY_SYNC_ENABLED === 'false', 'INVENTORY_SYNC_ENABLED debe ser false.');
guard(process.env.NODE_ENV !== 'production', 'NODE_ENV=production prohibido.');
guard(Boolean(process.env.DATABASE_URL), 'DATABASE_URL ausente.');
const url = new URL(process.env.DATABASE_URL);
guard(['postgres:','postgresql:'].includes(url.protocol), 'Protocolo no permitido.');
guard(['localhost','127.0.0.1'].includes(url.hostname), 'Base no local.');
guard(!url.port || url.port === '5432', 'Puerto distinto de 5432.');
guard(decodeURIComponent(url.pathname) === '/pos_novnix', 'Base distinta de pos_novnix.');
guard(!url.searchParams.has('host'), 'Host alternativo por query prohibido.');
guard(!url.searchParams.has('schema') || url.searchParams.get('schema') === 'pos', 'Esquema distinto de pos.');

const client = new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
const q = (sql, params=[]) => client.query(sql,params);
const rows = async (sql,params=[]) => (await q(sql,params)).rows;
const one = async (sql,params=[]) => (await rows(sql,params))[0];
const id = async (sql,params=[]) => String((await one(sql,params)).id);
const ok = msg => console.log(`[PASS] ${msg}`);
const tables = [
  'empresa','sucursal','almacen','usuario','unidad_medida','producto',
  'usuario_sucursal','usuario_rol','rol','rol_permiso','existencia',
  'movimiento_inventario','ajuste_inventario','sincronizacion_ecommerce_inventario','auditoria'
];
let server;
let committed = false;
let checks = 0;
const checked = (msg) => { ++checks; ok(msg); };

async function snapshot() {
  const counts = {};
  for(const name of tables) counts[name] = Number((await one(`SELECT count(*)::int AS n FROM pos.${name}`)).n);
  const outbox = await rows('SELECT * FROM pos.sincronizacion_ecommerce_inventario ORDER BY id');
  const audits = await rows('SELECT * FROM pos.auditoria ORDER BY id');
  const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return {
    counts, outboxHash:hash(outbox), auditHash:hash(audits),
    outstanding:outbox.filter(x => x.estado !== 'SINCRONIZADO').length
  };
}
async function preflight() {
  const before=await snapshot();
  // Runner integral v2 supplies the exact pre-execution historical audit count.
  // For standalone invocation, retain the legacy 44-event safety gate.
  const rawExpected = process.env.POS_INTEGRAL_BASELINE_AUDIT_COUNT;
  const expectedAudits = rawExpected === undefined ? 44 : Number(rawExpected);
  guard(Number.isSafeInteger(expectedAudits) && expectedAudits >= 44,
    'Conteo esperado de auditorías inválido. No se modifica la historia.');
  guard(before.counts.sincronizacion_ecommerce_inventario === 73 &&
    before.counts.auditoria === expectedAudits,
    `Baseline inconsistente: outbox esperado=73; auditoria esperada=${expectedAudits}. Revisar antes de ejecutar.`);
  guard(before.outstanding === 0, `Hay ${before.outstanding} eventos no sincronizados; no se inicia.`);
  const dangling = await one(`SELECT count(*)::int AS n FROM pos.empresa WHERE left(razon_social,5)='INVH_'`);
  guard(dangling.n===0, 'Se encontraron fixtures INVH previos: recuperar antes de ejecutar.');
  const roles=await one(`SELECT count(*)::int AS n FROM pos.rol WHERE left(codigo,7) IN ('R_INVH_','F_INVH_')`);
  guard(roles.n===0,'Roles temporales INVH previos detectados.');
  const perms=await rows(`SELECT codigo FROM pos.permiso WHERE codigo IN ('INVENTARIO.VER','INVENTARIO.AJUSTAR')`);
  guard(perms.length===2,'Se requieren permisos INVENTARIO.VER e INVENTARIO.AJUSTAR.');
  console.log('[INVH] PREFLIGHT:',JSON.stringify({
    outbox:before.counts.sincronizacion_ecommerce_inventario,
    no_sincronizados:before.outstanding,
    auditoria:before.counts.auditoria,
    outbox_hash:before.outboxHash.slice(0,16),audit_hash:before.auditHash.slice(0,16)
  }));
  ok('Preflight aprobado: sin escrituras.');
  return before;
}
async function createFixture(tag) {
  console.log('[INVH] MARCADOR DE RECUPERACION:',tag);
  await q('BEGIN');
  try {
    await q("SET LOCAL lock_timeout='5s'");
    await q("SET LOCAL statement_timeout='20000ms'");
    const a=await id('INSERT INTO pos.empresa(razon_social,nombre_comercial) VALUES($1,$1) RETURNING id::text',[`${tag}_A`]);
    const b=await id('INSERT INTO pos.empresa(razon_social,nombre_comercial) VALUES($1,$1) RETURNING id::text',[`${tag}_B`]);
    const unit=await id('INSERT INTO pos.unidad_medida(codigo,nombre,permite_decimales) VALUES($1,$2,false) RETURNING id::text',[`U_${tag}`,`Unidad ${tag}`]);
    const branchA=await id('INSERT INTO pos.sucursal(empresa_id,codigo,nombre) VALUES($1,$2,$3) RETURNING id::text',[a,`S_${tag}`,`Sucursal ${tag}`]);
    const branchB=await id('INSERT INTO pos.sucursal(empresa_id,codigo,nombre) VALUES($1,$2,$3) RETURNING id::text',[b,`S_${tag}`,`Sucursal ${tag}`]);
    const warehouseA=await id('INSERT INTO pos.almacen(sucursal_id,codigo,nombre) VALUES($1,$2,$3) RETURNING id::text',[branchA,`W_${tag}`,`Almacen ${tag}`]);
    const warehouseB=await id('INSERT INTO pos.almacen(sucursal_id,codigo,nombre) VALUES($1,$2,$3) RETURNING id::text',[branchB,`W_${tag}`,`Almacen ${tag}`]);
    const makeProduct=(company,kind) => id(`INSERT INTO pos.producto(empresa_id,unidad_medida_id,sku,codigo_barras,nombre,tipo,controla_inventario)
      VALUES($1,$2,$3,$4,$5,'PRODUCTO',true) RETURNING id::text`,
      [company,unit,`SKU_${kind}_${tag}`,`BAR_${kind}_${tag}`,`Producto ${kind} ${tag}`]);
    const productA=await makeProduct(a,'A');
    const productB=await makeProduct(b,'B');
    const perms=await rows(`SELECT id::text,codigo FROM pos.permiso
      WHERE codigo IN ('INVENTARIO.VER','INVENTARIO.AJUSTAR')`);
    assert.equal(perms.length,2);
    const permissionId=code=>perms.find(p=>p.codigo===code).id;
    const readRole=await id(`INSERT INTO pos.rol(codigo,nombre) VALUES($1,'Rol temporal INVH') RETURNING id::text`,[`R_${tag}`]);
    const fullRole=await id(`INSERT INTO pos.rol(codigo,nombre) VALUES($1,'Rol temporal INVH') RETURNING id::text`,[`F_${tag}`]);
    await q(`INSERT INTO pos.rol_permiso(rol_id,permiso_id) VALUES($1,$2),($3,$2),($3,$4)`,
      [readRole,permissionId('INVENTARIO.VER'),fullRole,permissionId('INVENTARIO.AJUSTAR')]);
    const newUser=(company,kind)=>id(`INSERT INTO pos.usuario
      (empresa_id,username,password_hash,nombre,activo,bloqueado)
      VALUES($1,$2,'INVH_TEST_NO_LOGIN',$3,true,false) RETURNING id::text`,
      [company,`${kind}_${tag}`,`Usuario ${kind} ${tag}`]);
    const reader=await newUser(a,'READER');
    const writer=await newUser(a,'WRITER');
    const foreign=await newUser(b,'FOREIGN');
    const denied=await newUser(a,'DENIED');
    await q(`INSERT INTO pos.usuario_rol(usuario_id,rol_id)
      VALUES($1,$2),($3,$4),($5,$6)`,[reader,readRole,writer,fullRole,foreign,fullRole]);
    await q(`INSERT INTO pos.usuario_sucursal(usuario_id,sucursal_id,es_predeterminada)
      VALUES($1,$2,true),($3,$2,true),($4,$5,true)`,[reader,branchA,writer,foreign,branchB]);
    await q('COMMIT');
    committed=true;
    ok(`Fixture aislado creado: ${tag}`);
    return {a,b,unit,branchA,branchB,warehouseA,warehouseB,productA,productB,
      reader,writer,foreign,denied,readRole,fullRole};
  } catch(error) { await q('ROLLBACK').catch(()=>{});throw error; }
}

/**
 * All destructive operations in this function are inside one transaction and
 * limited to the exact marker. Any unexpected synthetic shape aborts cleanup.
 */
async function cleanup(tag) {
  guard(markerRe.test(tag),'Marcador de recuperación incorrecto.');
  await q('BEGIN');
  try {
    await q("SET LOCAL lock_timeout='5s'");
    await q("SET LOCAL statement_timeout='20000ms'");
    const companies=await rows(`SELECT id::text,razon_social,nombre_comercial FROM pos.empresa
      WHERE razon_social IN ($1,$2) FOR UPDATE`,[`${tag}_A`,`${tag}_B`]);
    const units=await rows(`SELECT id::text,codigo,nombre FROM pos.unidad_medida
      WHERE codigo=$1 FOR UPDATE`,[`U_${tag}`]);
    const roles=await rows(`SELECT id::text,codigo,nombre FROM pos.rol
      WHERE codigo IN ($1,$2) FOR UPDATE`,[`R_${tag}`,`F_${tag}`]);
    if(companies.length===0 && units.length===0 && roles.length===0) {
      await q('ROLLBACK');
      console.log(`[INVH] ${tag}: marcador inexistente, nada que limpiar.`);
      return;
    }
    assert.equal(companies.length,2,'Empresas del marcador incompletas.');
    assert.equal(units.length,1,'Unidad del marcador incompleta.');
    assert.equal(roles.length,2,'Roles del marcador incompletos.');
    const company=idKind=>companies.find(x=>x.razon_social===`${tag}_${idKind}`);
    const A=company('A'), B=company('B');
    assert.ok(A && B);
    for(const c of companies) assert.equal(c.nombre_comercial,c.razon_social);
    assert.equal(units[0].nombre,`Unidad ${tag}`);
    assert.ok(roles.every(r=>r.nombre==='Rol temporal INVH'));
    const roleRead=roles.find(r=>r.codigo===`R_${tag}`);
    const roleFull=roles.find(r=>r.codigo===`F_${tag}`);
    assert.ok(roleRead && roleFull);
    const branches=await rows(`SELECT id::text,empresa_id::text,codigo,nombre FROM pos.sucursal
      WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`,[[A.id,B.id]]);
    assert.equal(branches.length,2,'Sucursales extra o faltantes.');
    assert.ok(branches.every(x=>x.codigo===`S_${tag}` && x.nombre===`Sucursal ${tag}`));
    const branchA=branches.find(x=>x.empresa_id===A.id);
    const branchB=branches.find(x=>x.empresa_id===B.id);
    assert.ok(branchA && branchB);
    const warehouses=await rows(`SELECT id::text,sucursal_id::text,codigo,nombre FROM pos.almacen
      WHERE sucursal_id=ANY($1::bigint[]) FOR UPDATE`,[branches.map(x=>x.id)]);
    assert.equal(warehouses.length,2,'Almacenes extra o faltantes.');
    assert.ok(warehouses.every(w=>w.codigo===`W_${tag}` && w.nombre===`Almacen ${tag}`));
    const whA=warehouses.find(w=>w.sucursal_id===branchA.id);
    const whB=warehouses.find(w=>w.sucursal_id===branchB.id);
    assert.ok(whA && whB);
    const products=await rows(`SELECT id::text,empresa_id::text,unidad_medida_id::text,sku,codigo_barras,nombre
      FROM pos.producto WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`,[[A.id,B.id]]);
    assert.equal(products.length,2,'Productos extras o faltantes.');
    const productA=products.find(p=>p.empresa_id===A.id);
    const productB=products.find(p=>p.empresa_id===B.id);
    assert.ok(productA && productB);
    for(const [p,kind] of [[productA,'A'],[productB,'B']]) {
      assert.equal(p.unidad_medida_id,units[0].id);
      assert.equal(p.sku,`SKU_${kind}_${tag}`);
      assert.equal(p.codigo_barras,`BAR_${kind}_${tag}`);
      assert.equal(p.nombre,`Producto ${kind} ${tag}`);
    }
    const users=await rows(`SELECT id::text,empresa_id::text,username,password_hash,nombre FROM pos.usuario
      WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`,[[A.id,B.id]]);
    assert.equal(users.length,4,'Usuarios extras o faltantes.');
    const expectedUsers=new Map([
      [`READER_${tag}`,A.id],[`WRITER_${tag}`,A.id],
      [`FOREIGN_${tag}`,B.id],[`DENIED_${tag}`,A.id]
    ]);
    for(const u of users) {
      assert.equal(u.empresa_id,expectedUsers.get(u.username));
      assert.equal(u.password_hash,'INVH_TEST_NO_LOGIN');
      assert.equal(u.nombre,`Usuario ${u.username.slice(0,u.username.indexOf('_'))} ${tag}`);
    }
    const writer=users.find(u=>u.username===`WRITER_${tag}`);
    assert.ok(writer);
    const userIds=users.map(u=>u.id);
    const rolePerms=await rows(`SELECT rp.rol_id::text,p.codigo FROM pos.rol_permiso rp
      JOIN pos.permiso p ON p.id=rp.permiso_id WHERE rp.rol_id=ANY($1::bigint[])`,[roles.map(r=>r.id)]);
    assert.equal(rolePerms.length,3);
    assert.ok(rolePerms.some(x=>x.rol_id===roleRead.id && x.codigo==='INVENTARIO.VER'));
    assert.ok(rolePerms.some(x=>x.rol_id===roleFull.id && x.codigo==='INVENTARIO.VER'));
    assert.ok(rolePerms.some(x=>x.rol_id===roleFull.id && x.codigo==='INVENTARIO.AJUSTAR'));
    const userRoles=await rows(`SELECT usuario_id::text,rol_id::text FROM pos.usuario_rol
      WHERE usuario_id=ANY($1::bigint[]) OR rol_id=ANY($2::bigint[])`,[userIds,roles.map(r=>r.id)]);
    assert.equal(userRoles.length,3,'Asignaciones de roles inesperadas.');
    assert.ok(userRoles.every(x=>userIds.includes(x.usuario_id) && roles.some(r=>r.id===x.rol_id)));
    const userBranches=await rows(`SELECT usuario_id::text,sucursal_id::text FROM pos.usuario_sucursal
      WHERE usuario_id=ANY($1::bigint[])`,[userIds]);
    assert.equal(userBranches.length,3,'Asignaciones de sucursal inesperadas.');
    assert.ok(userBranches.every(x=>userIds.includes(x.usuario_id) && branches.some(b=>b.id===x.sucursal_id)));
    const movements=await rows(`SELECT id::text,producto_id::text,almacen_id::text,usuario_id::text,tipo
      FROM pos.movimiento_inventario WHERE producto_id=ANY($1::bigint[]) FOR UPDATE`,[products.map(p=>p.id)]);
    guard(movements.length<=3,'Demasiados movimientos asociados al marcador.');
    for(const m of movements) {
      assert.equal(m.producto_id,productA.id);
      assert.equal(m.almacen_id,whA.id);
      assert.equal(m.usuario_id,writer.id);
      assert.ok(['AJUSTE_POSITIVO','AJUSTE_NEGATIVO'].includes(m.tipo));
    }
    const adjustments=await rows(`SELECT id::text,empresa_id::text,almacen_id::text,producto_id::text,
      usuario_id::text,movimiento_inventario_id::text,motivo FROM pos.ajuste_inventario
      WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`,[[A.id,B.id]]);
    assert.equal(adjustments.length,movements.length,'Ajustes no corresponden a movimientos.');
    for(const a of adjustments) {
      assert.equal(a.empresa_id,A.id);
      assert.equal(a.almacen_id,whA.id);
      assert.equal(a.producto_id,productA.id);
      assert.equal(a.usuario_id,writer.id);
      assert.equal(a.motivo,`Prueba HTTP ${tag}`);
      assert.ok(movements.some(m=>m.id===a.movimiento_inventario_id));
    }
    const movementIds=movements.map(m=>m.id);
    const events=movementIds.length ? await rows(`SELECT id::text,movimiento_inventario_id::text,estado,intentos
      FROM pos.sincronizacion_ecommerce_inventario WHERE movimiento_inventario_id=ANY($1::bigint[]) FOR UPDATE`,[movementIds]) : [];
    assert.equal(events.length,movements.length,'Eventos Ecommerce inesperados.');
    assert.ok(events.every(e=>e.estado==='PENDIENTE' && e.intentos===0),
      'Un evento sintético fue procesado: no se elimina automáticamente.');
    const stocks=await rows(`SELECT producto_id::text,almacen_id::text FROM pos.existencia
      WHERE producto_id=ANY($1::bigint[]) OR almacen_id=ANY($2::bigint[]) FOR UPDATE`,
      [products.map(p=>p.id),warehouses.map(w=>w.id)]);
    guard(stocks.length<=1,'Existencias extra detectadas.');
    assert.ok(stocks.every(s=>s.producto_id===productA.id && s.almacen_id===whA.id));
    const audits=await rows(`SELECT id::text,usuario_id::text,tabla,registro_id::text FROM pos.auditoria
      WHERE usuario_id=ANY($1::bigint[]) FOR UPDATE`,[userIds]);
    assert.equal(audits.length,adjustments.length,'Auditorías inesperadas.');
    assert.ok(audits.every(a=>a.usuario_id===writer.id && a.tabla==='ajuste_inventario' &&
      adjustments.some(x=>x.id===a.registro_id)));
    // Detect audits with missing user_id but synthetic adjustment IDs.
    if(adjustments.length) {
      const extraAudits=await rows(`SELECT id::text FROM pos.auditoria
        WHERE tabla='ajuste_inventario' AND registro_id=ANY($1::bigint[])
          AND (usuario_id IS NULL OR usuario_id<>$2)`,[adjustments.map(x=>x.id),writer.id]);
      assert.equal(extraAudits.length,0,'Auditoría inesperada en ajustes sintéticos.');
    }
    const remove=async(sql,params,expected)=>{
      const result=await q(sql,params);
      assert.equal(result.rowCount,expected,`Limpieza abortada: filas inesperadas (${sql.slice(0,80)}).`);
    };
    await remove(`DELETE FROM pos.auditoria WHERE usuario_id=ANY($1::bigint[])`,[userIds],audits.length);
    await remove(`DELETE FROM pos.ajuste_inventario WHERE empresa_id=ANY($1::bigint[])`,[[A.id,B.id]],adjustments.length);
    if(movementIds.length) await remove(`DELETE FROM pos.sincronizacion_ecommerce_inventario
      WHERE movimiento_inventario_id=ANY($1::bigint[])`,[movementIds],events.length);
    await remove(`DELETE FROM pos.existencia WHERE producto_id=ANY($1::bigint[]) OR almacen_id=ANY($2::bigint[])`,
      [products.map(p=>p.id),warehouses.map(w=>w.id)],stocks.length);
    await remove(`DELETE FROM pos.movimiento_inventario WHERE producto_id=ANY($1::bigint[])`,
      [products.map(p=>p.id)],movements.length);
    await remove(`DELETE FROM pos.usuario_sucursal WHERE usuario_id=ANY($1::bigint[])`,[userIds],userBranches.length);
    await remove(`DELETE FROM pos.usuario_rol WHERE usuario_id=ANY($1::bigint[])`,[userIds],userRoles.length);
    await remove(`DELETE FROM pos.producto WHERE empresa_id=ANY($1::bigint[])`,[[A.id,B.id]],products.length);
    await remove(`DELETE FROM pos.usuario WHERE id=ANY($1::bigint[])`,[userIds],users.length);
    await remove(`DELETE FROM pos.rol_permiso WHERE rol_id=ANY($1::bigint[])`,[roles.map(r=>r.id)],rolePerms.length);
    await remove(`DELETE FROM pos.rol WHERE id=ANY($1::bigint[])`,[roles.map(r=>r.id)],roles.length);
    await remove(`DELETE FROM pos.almacen WHERE id=ANY($1::bigint[])`,[warehouses.map(w=>w.id)],warehouses.length);
    await remove(`DELETE FROM pos.sucursal WHERE id=ANY($1::bigint[])`,[branches.map(b=>b.id)],branches.length);
    await remove(`DELETE FROM pos.unidad_medida WHERE id=$1 AND codigo=$2`,[units[0].id,`U_${tag}`],1);
    await remove(`DELETE FROM pos.empresa WHERE id=ANY($1::bigint[])`,[[A.id,B.id]],companies.length);
    await q('COMMIT');
    ok(`Limpieza aislada completada: ${tag}`);
  } catch(error) { await q('ROLLBACK').catch(()=>{}); throw error; }
}

async function runHttp(tag, f) {
  // Import app, never server.ts: the Ecommerce worker is not started.
  const [{app},{tokenService}] = await Promise.all([
    import('../../src/app.js'),
    import('../../src/modules/auth/token.service.js')
  ]);
  const tokens={};
  for(const name of ['reader','writer','foreign','denied']) {
    const companyId = name==='foreign' ? f.b : f.a;
    tokens[name] = await tokenService.createAccessToken({userId:BigInt(f[name]),empresaId:BigInt(companyId)});
  }
  server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api/v1/inventory`;
  const request=async(method,path,actor,expected,body,key) => {
    const auth=actor===null ? null : actor==='invalid' ? 'not-a-jwt' : tokens[actor];
    const res=await fetch(base+path,{
      method,
      headers:{
        ...(auth ? {Authorization:`Bearer ${auth}`} : {}),
        ...(body!==undefined ? {'Content-Type':'application/json'} : {}),
        ...(key ? {'Idempotency-Key':key} : {})
      },
      ...(body!==undefined ? {body:JSON.stringify(body)} : {}),
      signal:AbortSignal.timeout(15000)
    });
    const data=await res.json().catch(()=>null);
    assert.equal(res.status,expected,`${method} ${path}: expected ${expected}, actual ${res.status}, response ${JSON.stringify(data)}`);
    return data;
  };
  await request('GET','/warehouses',null,401);
  checked('Sin JWT: HTTP 401');
  await request('GET','/warehouses','invalid',401);
  checked('JWT inválido: HTTP 401');
  await request('GET','/warehouses','denied',403);
  checked('JWT sin permiso de lectura: HTTP 403');
  const wh=await request('GET','/warehouses?limit=100','reader',200);
  assert.ok(Array.isArray(wh.data) && wh.data.some(x=>x.id===f.warehouseA));
  assert.ok(wh.data.every(x=>x.id!==f.warehouseB));
  checked('Consulta almacenes: HTTP 200, aislamiento multiempresa');
  const foreignWh=await request('GET','/warehouses?limit=100','foreign',200);
  assert.ok(foreignWh.data.some(x=>x.id===f.warehouseB));
  assert.ok(foreignWh.data.every(x=>x.id!==f.warehouseA));
  checked('Usuario de empresa distinta: solo almacenes propios');
  await request('GET',`/stock?almacen_id=${f.warehouseA}`,'foreign',404);
  checked('Stock de almacén ajeno: HTTP 404');
  await request('GET',`/kardex?almacen_id=${f.warehouseA}&producto_id=${f.productA}`,'foreign',404);
  checked('Kardex de almacén ajeno: HTTP 404');
  await request('GET',`/stock?almacen_id=${f.warehouseA}&page=0`,'reader',400);
  await request('GET','/stock','reader',400);
  checked('Consultas con parámetros inválidos: HTTP 400');
  await request('GET',`/stock?almacen_id=${f.warehouseA}`,'reader',200);
  await request('GET',`/movements?almacen_id=${f.warehouseA}`,'reader',200);
  checked('Consultas iniciales de existencias y movimientos');
  await request('POST','/adjustments','reader',403,{},randomUUID());
  checked('Sin permiso INVENTARIO.AJUSTAR: HTTP 403');
  await request('POST','/adjustments','writer',400,{},randomUUID());
  checked('Ajuste con cuerpo inválido: HTTP 400');
  const body={
    almacen_id:f.warehouseA,producto_id:f.productA,tipo:'AJUSTE_POSITIVO',
    cantidad:'2',costo_unitario:'10.0000',motivo:`Prueba HTTP ${tag}`,
    sincronizar_ecommerce:true
  };
  const key=randomUUID();
  const first=await request('POST','/adjustments','writer',201,body,key);
  assert.equal(first.replayed,false);
  assert.equal(first.data.existencia_despues.cantidad,'2.000');
  assert.ok(first.data.sincronizacion.evento_id);
  checked('Ajuste positivo HTTP 201 con evento Ecommerce pendiente');
  const replay=await request('POST','/adjustments','writer',200,body,key);
  assert.equal(replay.replayed,true);
  assert.deepEqual(replay.data,first.data);
  checked('Idempotencia: HTTP 200 sin nuevos movimientos');
  const conflicting={...body,cantidad:'3'};
  await request('POST','/adjustments','writer',409,conflicting,key);
  checked('Misma clave con contenido distinto: HTTP 409');
  await request('POST','/adjustments','foreign',404,body,randomUUID());
  checked('Empresa ajena no puede ajustar otro almacén: HTTP 404');
  await request('POST','/adjustments','writer',409,
    {...body,tipo:'AJUSTE_NEGATIVO',cantidad:'999',costo_unitario:null},randomUUID());
  checked('No permite sacar más existencias que las disponibles');
  const concurrentBody={...body,cantidad:'1',costo_unitario:null};
  const concurrentKey=randomUUID();
  const pair=await Promise.all([0,1].map(async()=>{
    const res=await fetch(base+'/adjustments',{
      method:'POST',
      headers:{Authorization:`Bearer ${tokens.writer}`,'Content-Type':'application/json','Idempotency-Key':concurrentKey},
      body:JSON.stringify(concurrentBody),signal:AbortSignal.timeout(15000)
    });
    return {status:res.status,data:await res.json()};
  }));
  assert.deepEqual(pair.map(x=>x.status).sort(),[200,201],`Concurrencia: ${JSON.stringify(pair)}`);
  assert.equal(pair.filter(x=>!x.data.replayed).length,1);
  assert.equal(pair[0].data.data.ajuste_id,pair[1].data.data.ajuste_id);
  checked('Dos POST simultáneos: exactamente un ajuste nuevo');
  const negative=await request('POST','/adjustments','writer',201,
    {...body,tipo:'AJUSTE_NEGATIVO',cantidad:'1',costo_unitario:null},randomUUID());
  assert.equal(negative.data.existencia_despues.cantidad,'2.000');
  checked('Salida real, stock correcto, HTTP 201');
  const stock=await request('GET',`/stock?almacen_id=${f.warehouseA}`,'reader',200);
  assert.ok(stock.data.some(x=>x.producto.id===f.productA));
  const movements=await request('GET',`/movements?almacen_id=${f.warehouseA}`,'reader',200);
  assert.ok(movements.data.length>=3);
  const kardex=await request('GET',`/kardex?almacen_id=${f.warehouseA}&producto_id=${f.productA}`,'reader',200);
  assert.ok(kardex.data.length>=3);
  checked('Stock, movimientos y kardex actualizados después del ajuste');
  const counts=await one(`SELECT
     (SELECT count(*)::int FROM pos.ajuste_inventario WHERE empresa_id=$1) AS ajustes,
     (SELECT count(*)::int FROM pos.movimiento_inventario WHERE producto_id=$2) AS movimientos,
     (SELECT count(*)::int FROM pos.sincronizacion_ecommerce_inventario e
       JOIN pos.movimiento_inventario m ON e.movimiento_inventario_id=m.id
       WHERE m.producto_id=$2) AS outbox,
     (SELECT count(*)::int FROM pos.auditoria WHERE usuario_id=$3) AS auditorias`,
    [f.a,f.productA,f.writer]);
  assert.deepEqual(counts,{ajustes:3,movimientos:3,outbox:3,auditorias:3});
  checked('PostgreSQL: 3 ajustes, 3 movimientos, 3 eventos, 3 auditorías');
  console.log(`[INVH] HTTP aprobado: ${checks} verificaciones.`);
}

async function main() {
  let before;
  let failed=false;
  try {
    await client.connect();
    const actual=await one('SELECT current_database() AS db, current_schema() AS esquema');
    guard(actual.db==='pos_novnix','La conexión real no corresponde a pos_novnix.');
    if(mode==='--cleanup-marker') {
      console.log('[INVH] Recuperación manual solicitada:',marker);
      await cleanup(marker);
      console.log('[INVH] Verificar nuevamente con --preflight.');
      return;
    }
    before=await preflight();
    if(mode==='--preflight') return;
    const fixture=await createFixture(marker);
    await runHttp(marker,fixture);
  } catch(error) {
    failed=true;
    console.error('[INVH ERROR]',error instanceof Error ? error.message : String(error));
    process.exitCode=1;
  } finally {
    if(server) {
      try { await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve())); }
      catch(error) { failed=true; process.exitCode=1; console.error('[INVH] No se pudo cerrar Express:',error.message); }
    }
    if(mode==='--run' && committed) {
      try {
        await cleanup(marker);
        const after=await snapshot();
        assert.deepEqual(after,before,'Conteos/huellas históricos no fueron restaurados.');
        ok('Integridad histórica completa restaurada: outbox, auditoría y conteos.');
        console.log('[INVH] POSTFLIGHT:',JSON.stringify({
          outbox:after.counts.sincronizacion_ecommerce_inventario,
          auditoria:after.counts.auditoria,
          outbox_hash:after.outboxHash.slice(0,16),audit_hash:after.auditHash.slice(0,16)
        }));
      } catch(error) {
        failed=true;
        process.exitCode=1;
        console.error('[INVH] Falló limpieza o integridad:',error.message);
        console.error('[INVH] CONSERVAR MARCADOR:',marker);
        console.error(`[INVH] Recuperación: node --import tsx tests/inventory/inventory-http-isolated-pos-novnix.integration.mjs --cleanup-marker ${marker}`);
      }
    }
    await client.end().catch(()=>{});
    if(mode==='--run' && !failed) console.log(`[INVH] INTEGRACION HTTP COMPLETADA: ${checks}/${checks}.`);
  }
}
main().catch(error=>{
  console.error('[INVH FATAL]',error instanceof Error ? error.message : String(error));
  process.exitCode=1;
});
