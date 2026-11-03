/**
 * M13 administrative HTTP retry integration against local pos_novnix (schema pos).
 * Usage: node --import tsx tests/ecommerce-sync/m13-http-admin-retry-pos-novnix.integration.mjs --preflight
 *        node --import tsx tests/ecommerce-sync/m13-http-admin-retry-pos-novnix.integration.mjs --run
 *        node --import tsx tests/ecommerce-sync/m13-http-admin-retry-pos-novnix.integration.mjs --cleanup-marker M13R_XXXXXXXXXX
 * Creates only synthetic fixtures. Starts Express on 127.0.0.1, no Ecommerce API calls.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';
import { prisma } from '../../src/lib/prisma.js';

const mode = process.argv[2];
const markerRx = /^M13R_[A-F0-9]{10}$/;
const marker = mode === '--cleanup-marker' ? process.argv[3] :
  `M13R_${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;

function guard(ok, reason) {
  if (!ok) throw new Error(`[M13R SEGURIDAD] ${reason}`);
}
guard(['--preflight', '--run', '--cleanup-marker'].includes(mode), 'Modo no admitido.');
guard(process.argv.length === (mode === '--cleanup-marker' ? 4 : 3), 'Argumentos inesperados.');
guard(markerRx.test(marker), 'Marcador inválido.');
guard(process.env.POS_ALLOW_TEST_DB === 'SI', 'POS_ALLOW_TEST_DB=SI obligatorio.');
guard(process.env.INVENTORY_SYNC_ENABLED === 'false', 'Worker debe estar deshabilitado.');
guard(process.env.NODE_ENV !== 'production', 'Prohibido NODE_ENV=production.');
guard(typeof process.env.DATABASE_URL === 'string', 'DATABASE_URL ausente.');
const target = new URL(process.env.DATABASE_URL);
guard(['postgres:', 'postgresql:'].includes(target.protocol), 'Solo PostgreSQL.');
guard(['localhost', '127.0.0.1'].includes(target.hostname), 'Solo PostgreSQL local.');
guard(!target.port || target.port === '5432', 'Solo puerto 5432.');
guard(decodeURIComponent(target.pathname) === '/pos_novnix', 'Base no autorizada.');
guard(!target.searchParams.has('host'), 'Parámetro host no autorizado.');
guard(!target.searchParams.has('schema') || target.searchParams.get('schema') === 'pos', 'Esquema distinto a pos.');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const query = (sql, params=[]) => client.query(sql, params);
const rows = async (sql, params=[]) => (await query(sql, params)).rows;
const one = async (sql, params=[]) => (await rows(sql, params))[0];
const insertId = async (sql, params=[]) => String((await one(sql, params)).id);
const pass = text => console.log(`[PASS] ${text}`);
let fixtureCommitted = false;
let server = null;
let httpChecks = 0;
const httpPass = text => { httpChecks++; pass(text); };

const tables = [
  'unidad_medida', 'empresa', 'sucursal', 'almacen', 'producto', 'usuario',
  'usuario_sucursal', 'rol', 'rol_permiso', 'usuario_rol', 'movimiento_inventario', 'existencia',
  'sincronizacion_ecommerce_inventario', 'auditoria'
];
async function snapshot() {
  const counts = {};
  for (const table of tables) {
    counts[table] = Number((await one(`SELECT count(*)::int AS n FROM pos.${table}`)).n);
  }
  const historical = await rows(`SELECT id::text, operation_id, estado, intentos, ultimo_error,
    ecommerce_product_id::text, sincronizado_en::text
    FROM pos.sincronizacion_ecommerce_inventario ORDER BY id`);
  const fingerprint = createHash('sha256').update(JSON.stringify(historical)).digest('hex');
  const active = Number((await one(`SELECT count(*)::int AS n
    FROM pos.sincronizacion_ecommerce_inventario WHERE estado <> 'SINCRONIZADO'`)).n);
  const historicalAudits = await rows(`SELECT id::text, usuario_id::text, tabla, registro_id::text,
    accion, datos_anteriores, datos_nuevos, ip_origen::text, creado_en::text
    FROM pos.auditoria ORDER BY id`);
  const auditFingerprint = createHash('sha256').update(JSON.stringify(historicalAudits)).digest('hex');
  return { counts, fingerprint, auditFingerprint, active };
}
async function preflight() {
  const before = await snapshot();
  guard(before.active === 0, `Hay ${before.active} eventos históricos no sincronizados; se cancela.`);
  const existing = await one(`SELECT count(*)::int AS n FROM pos.empresa
    WHERE left(razon_social,5) = 'M13R_'`);
  guard(existing.n === 0, 'Existen fixtures M13R sin recuperar; revisar primero.');
  const orphanRoles = await one(`SELECT count(*)::int AS n FROM pos.rol
    WHERE codigo LIKE 'R_M13R_%'`);
  guard(orphanRoles.n === 0, 'Existen roles de pruebas M13R sin limpiar.');
  const permission = await one(`SELECT id::text FROM pos.permiso
    WHERE codigo='ECOMMERCE_SYNC.REINTENTAR' AND modulo='ECOMMERCE_SYNC'`);
  guard(permission, 'Falta permiso administrativo ECOMMERCE_SYNC.REINTENTAR.');
  console.log('[M13R] PREFLIGHT:', JSON.stringify({
    outbox: before.counts.sincronizacion_ecommerce_inventario,
    eventos_no_sincronizados: before.active,
    auditoria: before.counts.auditoria,
    fingerprint: before.fingerprint.slice(0,16),
    audit_fingerprint: before.auditFingerprint.slice(0,16)
  }));
  return before;
}

async function createFixture() {
  console.log('[M13R] MARCADOR DE RECUPERACION:', marker);
  await query('BEGIN');
  try {
    await query("SET LOCAL lock_timeout='5s'");
    await query("SET LOCAL statement_timeout='20000ms'");
    const unit = await insertId(`INSERT INTO pos.unidad_medida(codigo,nombre,permite_decimales)
      VALUES ($1,$2,false) RETURNING id::text`, [`UNIT_${marker}`, `Unidad ${marker}`]);
    const company = await insertId(`INSERT INTO pos.empresa(razon_social,nombre_comercial)
      VALUES ($1,$1) RETURNING id::text`, [marker]);
    const otherCompany = await insertId(`INSERT INTO pos.empresa(razon_social,nombre_comercial)
      VALUES ($1,$1) RETURNING id::text`, [`${marker}_ALT`]);
    const branch = await insertId(`INSERT INTO pos.sucursal(empresa_id,codigo,nombre)
      VALUES ($1,$2,$3) RETURNING id::text`, [company, `S_${marker}`, `Sucursal ${marker}`]);
    const warehouse = await insertId(`INSERT INTO pos.almacen(sucursal_id,codigo,nombre)
      VALUES ($1,$2,$3) RETURNING id::text`, [branch, `A_${marker}`, `Almacén ${marker}`]);
    const product = await insertId(`INSERT INTO pos.producto
      (empresa_id,unidad_medida_id,sku,codigo_barras,nombre,precio_venta,costo_referencia,tipo,controla_inventario)
      VALUES ($1,$2,$3,$4,$5,100.00,0.0000,'PRODUCTO',true) RETURNING id::text`,
      [company,unit,`SKU_${marker}`,`BAR_${marker}`,`Producto ${marker}`]);
    const permission = await one(`SELECT id::text FROM pos.permiso
      WHERE codigo='ECOMMERCE_SYNC.REINTENTAR' AND modulo='ECOMMERCE_SYNC'`);
    assert.ok(permission, 'Falta permiso administrativo.');
    const role = await insertId(`INSERT INTO pos.rol(codigo,nombre)
      VALUES ($1,'Rol temporal M13R') RETURNING id::text`,[`R_${marker}`]);
    await query(`INSERT INTO pos.rol_permiso(rol_id,permiso_id)
      VALUES ($1,$2)`,[role,permission.id]);
    const newUser = (companyId, prefix) => insertId(`INSERT INTO pos.usuario
      (empresa_id,username,password_hash,nombre,activo,bloqueado)
      VALUES ($1,$2,'M13R_FIXTURE_NOT_FOR_LOGIN',$3,true,false) RETURNING id::text`,
      [companyId,`${prefix}_${marker}`,`Usuario ${prefix} ${marker}`]);
    const authorized = await newUser(company,'AUTH');
    const unassigned = await newUser(company,'NOACCESS');
    const otherUser = await newUser(otherCompany,'OTHER');
    const denied = await newUser(company,'DENIED');
    for (const userId of [authorized,unassigned,otherUser]) {
      await query(`INSERT INTO pos.usuario_rol(usuario_id,rol_id)
        VALUES ($1,$2)`,[userId,role]);
    }
    await query(`INSERT INTO pos.usuario_sucursal(usuario_id,sucursal_id,es_predeterminada)
      VALUES ($1,$2,true),($3,$4,true)`, [authorized,branch,denied,branch]);
    const movement = await insertId(`INSERT INTO pos.movimiento_inventario
      (producto_id,almacen_id,tipo,cantidad,costo_unitario,documento_tipo,motivo)
      VALUES ($1,$2,'ENTRADA',1.000,0.0000,'TEST_M13R',$3) RETURNING id::text`,
      [product,warehouse,marker]);
    const stock = await one(`SELECT cantidad::text,reservado::text FROM pos.existencia
      WHERE producto_id=$1 AND almacen_id=$2`,[product,warehouse]);
    assert.ok(stock, 'Trigger no generó existencia sintética.');
    assert.equal(Number(stock.cantidad),1);
    assert.equal(Number(stock.reservado),0);
    const event = await insertId(`INSERT INTO pos.sincronizacion_ecommerce_inventario
      (movimiento_inventario_id,operation_id,codigo_barras,sku,adjustment,estado,intentos)
      VALUES ($1,$2,NULL,$3,1,'AGOTADO',10) RETURNING id::text`,
      [movement,marker,`SKU_${marker}`]);
    await query('COMMIT');
    fixtureCommitted = true;
    pass('Fixture aislado creado, trigger e IDs sintéticos verificados');
    return { unit,company,otherCompany,branch,warehouse,product,authorized,unassigned,otherUser,denied,role,movement,event };
  } catch (err) {
    await query('ROLLBACK').catch(()=>{});
    throw err;
  }
}

async function cleanup(tag) {
  guard(markerRx.test(tag),'Marcador de recuperación inválido.');
  await query('BEGIN');
  try {
    await query("SET LOCAL lock_timeout='5s'");
    await query("SET LOCAL statement_timeout='20000ms'");
    const companies = await rows(`SELECT id::text,razon_social,nombre_comercial FROM pos.empresa
      WHERE razon_social IN ($1,$2) ORDER BY razon_social FOR UPDATE`,[tag,`${tag}_ALT`]);
    const units = await rows(`SELECT id::text,codigo,nombre FROM pos.unidad_medida
      WHERE codigo=$1 FOR UPDATE`,[`UNIT_${tag}`]);
    if (!companies.length && !units.length) {
      const orphanRole=await one(`SELECT id::text FROM pos.rol WHERE codigo=$1`,[`R_${tag}`]);
      assert.ok(!orphanRole,'Se halló un rol huérfano sin fixture: revisar manualmente.');
      await query('ROLLBACK');
      console.log('[M13R] Marcador inexistente: sin filas propias para limpiar.');
      return;
    }
    assert.equal(companies.length,2,'Empresas sintéticas ausentes o duplicadas.');
    assert.equal(units.length,1,'Unidad sintética ausente.');
    const company = companies.find(x=>x.razon_social===tag);
    const alt = companies.find(x=>x.razon_social===`${tag}_ALT`);
    assert.ok(company && alt);
    for(const c of companies) assert.equal(c.nombre_comercial,c.razon_social);
    const unit=units[0]; assert.equal(unit.nombre,`Unidad ${tag}`);
    const roles=await rows(`SELECT id::text,codigo,nombre FROM pos.rol
      WHERE codigo=$1 FOR UPDATE`,[`R_${tag}`]);
    assert.equal(roles.length,1,'Rol sintético ausente o duplicado.');
    const role=roles[0]; assert.equal(role.nombre,'Rol temporal M13R');
    const rolePermissions=await rows(`SELECT rp.permiso_id::text,p.codigo
      FROM pos.rol_permiso rp JOIN pos.permiso p ON p.id=rp.permiso_id
      WHERE rp.rol_id=$1 FOR UPDATE OF rp`,[role.id]);
    assert.equal(rolePermissions.length,1,'Permisos de rol sintético modificados.');
    assert.equal(rolePermissions[0].codigo,'ECOMMERCE_SYNC.REINTENTAR');
    const branches=await rows(`SELECT id::text,codigo,nombre FROM pos.sucursal
      WHERE empresa_id=$1 FOR UPDATE`,[company.id]);
    assert.equal(branches.length,1); const branch=branches[0];
    assert.equal(branch.codigo,`S_${tag}`); assert.equal(branch.nombre,`Sucursal ${tag}`);
    assert.equal((await rows(`SELECT id FROM pos.sucursal WHERE empresa_id=$1`,[alt.id])).length,0);
    const warehouses=await rows(`SELECT id::text,codigo,nombre FROM pos.almacen
      WHERE sucursal_id=$1 FOR UPDATE`,[branch.id]);
    assert.equal(warehouses.length,1); const warehouse=warehouses[0];
    assert.equal(warehouse.codigo,`A_${tag}`);assert.equal(warehouse.nombre,`Almacén ${tag}`);
    const products=await rows(`SELECT id::text,sku,codigo_barras,nombre,unidad_medida_id::text FROM pos.producto
      WHERE empresa_id=$1 FOR UPDATE`,[company.id]);
    assert.equal(products.length,1); const product=products[0];
    assert.equal(product.sku,`SKU_${tag}`);assert.equal(product.codigo_barras,`BAR_${tag}`);
    assert.equal(product.nombre,`Producto ${tag}`);assert.equal(product.unidad_medida_id,unit.id);
    assert.equal((await rows(`SELECT id FROM pos.producto WHERE empresa_id=$1`,[alt.id])).length,0);
    const users=await rows(`SELECT id::text,username,empresa_id::text,nombre,password_hash FROM pos.usuario
      WHERE empresa_id IN ($1,$2) FOR UPDATE`,[company.id,alt.id]);
    assert.equal(users.length,4,'Usuarios de fixture inesperados.');
    const auth=users.find(x=>x.username===`AUTH_${tag}` && x.empresa_id===company.id);
    const noaccess=users.find(x=>x.username===`NOACCESS_${tag}` && x.empresa_id===company.id);
    const other=users.find(x=>x.username===`OTHER_${tag}` && x.empresa_id===alt.id);
    const denied=users.find(x=>x.username===`DENIED_${tag}` && x.empresa_id===company.id);
    assert.ok(auth && noaccess && other && denied,'Identidades sintéticas no coinciden.');
    for(const user of users) {
      assert.equal(user.password_hash,'M13R_FIXTURE_NOT_FOR_LOGIN');
      const prefix=user.username.split('_M13R_')[0];
      assert.equal(user.nombre,`Usuario ${prefix} ${tag}`);
    }
    const userRoles=await rows(`SELECT usuario_id::text,rol_id::text FROM pos.usuario_rol
      WHERE usuario_id=ANY($1::bigint[])`,[users.map(x=>x.id)]);
    assert.equal(userRoles.length,3,'Asignaciones de roles sintéticos inesperadas.');
    assert.ok(userRoles.every(x=>x.rol_id===role.id));
    assert.ok(!userRoles.some(x=>x.usuario_id===denied.id));
    const extraRoleUsers=await rows(`SELECT usuario_id::text FROM pos.usuario_rol
      WHERE rol_id=$1 AND NOT (usuario_id=ANY($2::bigint[]))`,[role.id,users.map(x=>x.id)]);
    assert.equal(extraRoleUsers.length,0,'El rol temporal fue asignado a usuario externo.');
    const assignments=await rows(`SELECT usuario_id::text,sucursal_id::text
      FROM pos.usuario_sucursal WHERE usuario_id=ANY($1::bigint[])`,[users.map(x=>x.id)]);
    assert.equal(assignments.length,2,'Asignaciones de sucursal inesperadas.');
    assert.ok(assignments.some(x=>x.usuario_id===auth.id && x.sucursal_id===branch.id));
    assert.ok(assignments.some(x=>x.usuario_id===denied.id && x.sucursal_id===branch.id));
    const movements=await rows(`SELECT id::text,almacen_id::text,tipo,cantidad::text,documento_tipo,motivo
      FROM pos.movimiento_inventario WHERE producto_id=$1 FOR UPDATE`,[product.id]);
    assert.equal(movements.length,1);const movement=movements[0];
    assert.equal(movement.almacen_id,warehouse.id);assert.equal(movement.tipo,'ENTRADA');
    assert.equal(Number(movement.cantidad),1);assert.equal(movement.documento_tipo,'TEST_M13R');
    assert.equal(movement.motivo,tag);
    const events=await rows(`SELECT id::text,operation_id,sku,codigo_barras,adjustment,estado,intentos,
      ecommerce_product_id::text,ultimo_error FROM pos.sincronizacion_ecommerce_inventario
      WHERE movimiento_inventario_id=$1 FOR UPDATE`,[movement.id]);
    assert.equal(events.length,1);const event=events[0];
    assert.equal(event.operation_id,tag);assert.equal(event.sku,`SKU_${tag}`);
    assert.equal(event.codigo_barras,null);assert.equal(event.adjustment,1);
    assert.ok(['AGOTADO','REINTENTO_MANUAL','PROCESANDO_MANUAL','SINCRONIZADO'].includes(event.estado));
    assert.ok(event.intentos>=10 && event.intentos<=13);
    assert.ok(event.ecommerce_product_id===null || event.ecommerce_product_id==='987654321');
    assert.ok(event.ultimo_error===null || event.ultimo_error.startsWith('M13R_TEST_'));
    const stocks=await rows(`SELECT producto_id::text,almacen_id::text,cantidad::text,reservado::text
      FROM pos.existencia WHERE producto_id=$1 OR almacen_id=$2 FOR UPDATE`,[product.id,warehouse.id]);
    assert.equal(stocks.length,1); assert.equal(stocks[0].producto_id,product.id);
    assert.equal(stocks[0].almacen_id,warehouse.id); assert.equal(Number(stocks[0].cantidad),1);
    assert.equal(Number(stocks[0].reservado),0);
    const audits=await rows(`SELECT id::text,usuario_id::text,tabla,registro_id::text,accion,datos_nuevos
      FROM pos.auditoria WHERE tabla='sincronizacion_ecommerce_inventario' AND registro_id=$1 FOR UPDATE`,[event.id]);
    assert.ok(audits.length<=1,'Auditorías adicionales detectadas.');
    for(const audit of audits){
      assert.equal(audit.usuario_id,auth.id);assert.equal(audit.tabla,'sincronizacion_ecommerce_inventario');
      assert.equal(audit.registro_id,event.id);assert.equal(audit.accion,'UPDATE');
      assert.equal(audit.datos_nuevos?.accion,'AUTORIZAR_REINTENTO');
      assert.equal(audit.datos_nuevos?.operation_id,tag);
    }
    const remove=async(sql,args,count)=>{
      const r=await query(sql,args);
      assert.equal(r.rowCount,count,`Limpieza abortada: cantidad eliminada inesperada (${sql}).`);
    };
    if(audits.length) await remove(`DELETE FROM pos.auditoria
      WHERE tabla='sincronizacion_ecommerce_inventario' AND registro_id=$1`,[event.id],audits.length);
    await remove(`DELETE FROM pos.usuario_sucursal WHERE usuario_id=ANY($1::bigint[])
      AND sucursal_id=$2`,[[auth.id,denied.id],branch.id],2);
    await remove(`DELETE FROM pos.usuario_rol WHERE rol_id=$1
      AND usuario_id=ANY($2::bigint[])`,[role.id,[auth.id,noaccess.id,other.id]],3);
    await remove(`DELETE FROM pos.sincronizacion_ecommerce_inventario WHERE id=$1 AND operation_id=$2`,[event.id,tag],1);
    await remove(`DELETE FROM pos.existencia WHERE producto_id=$1 AND almacen_id=$2`,[product.id,warehouse.id],1);
    await remove(`DELETE FROM pos.movimiento_inventario WHERE id=$1 AND motivo=$2`,[movement.id,tag],1);
    await remove(`DELETE FROM pos.producto WHERE id=$1 AND sku=$2`,[product.id,`SKU_${tag}`],1);
    for(const u of users) await remove(`DELETE FROM pos.usuario WHERE id=$1 AND username=$2`,[u.id,u.username],1);
    await remove(`DELETE FROM pos.rol_permiso WHERE rol_id=$1 AND permiso_id=$2`,
      [role.id,rolePermissions[0].permiso_id],1);
    await remove(`DELETE FROM pos.rol WHERE id=$1 AND codigo=$2`,[role.id,`R_${tag}`],1);
    await remove(`DELETE FROM pos.almacen WHERE id=$1 AND codigo=$2`,[warehouse.id,`A_${tag}`],1);
    await remove(`DELETE FROM pos.sucursal WHERE id=$1 AND codigo=$2`,[branch.id,`S_${tag}`],1);
    await remove(`DELETE FROM pos.empresa WHERE id=$1 AND razon_social=$2`,[company.id,tag],1);
    await remove(`DELETE FROM pos.empresa WHERE id=$1 AND razon_social=$2`,[alt.id,`${tag}_ALT`],1);
    await remove(`DELETE FROM pos.unidad_medida WHERE id=$1 AND codigo=$2`,[unit.id,`UNIT_${tag}`],1);
    await query('COMMIT');
    pass('Limpieza verificada de auditorías, usuarios, outbox, existencia y estructuras sintéticas');
  } catch(error){await query('ROLLBACK').catch(()=>{});throw error;}
}

async function state(id) {
  return one(`SELECT id::text, operation_id, estado, intentos, ultimo_error,
    ecommerce_product_id::text FROM pos.sincronizacion_ecommerce_inventario
    WHERE id=$1 AND operation_id=$2`,[id,marker]);
}
async function auditsOf(id) {
  return rows(`SELECT id::text,usuario_id::text,tabla,registro_id::text,accion,
    datos_anteriores,datos_nuevos FROM pos.auditoria
    WHERE tabla='sincronizacion_ecommerce_inventario' AND registro_id=$1
    ORDER BY id`,[id]);
}
async function httpTests(ids) {
  const [{app},{tokenService}] = await Promise.all([
    import('../../src/app.js'),
    import('../../src/modules/auth/token.service.js')
  ]);
  const users = {
    AUTH: {userId: BigInt(ids.authorized),empresaId: BigInt(ids.company)},
    NOACCESS: {userId: BigInt(ids.unassigned),empresaId: BigInt(ids.company)},
    OTHER: {userId: BigInt(ids.otherUser),empresaId: BigInt(ids.otherCompany)},
    DENIED: {userId: BigInt(ids.denied),empresaId: BigInt(ids.company)}
  };
  const tokens={};
  for(const [key,actor] of Object.entries(users)){
    tokens[key]=await tokenService.createAccessToken(actor);
  }
  server = app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const addr=server.address();
  assert.ok(addr && typeof addr !== 'string','Express no abrió puerto local.');
  const base=`http://127.0.0.1:${addr.port}/api/v1/ecommerce-sync`;
  async function request(user,path,method='POST') {
    const headers = user ? {Authorization:`Bearer ${tokens[user]}`} : {};
    const response = await fetch(base+path,{method,headers,signal:AbortSignal.timeout(10000)});
    const body=await response.json();
    return {status:response.status,body};
  }
  async function expectStatus(user,path,status,method='POST'){
    const response=await request(user,path,method);
    assert.equal(response.status,status,`${user??'anon'} ${method} ${path}: ${JSON.stringify(response.body)}`);
    return response.body;
  }
  const uri=`/${ids.event}/retry`;
  await expectStatus(null,uri,401);
  httpPass('Sin JWT: HTTP 401');

  await expectStatus('DENIED',uri,403);
  httpPass('JWT sin ECOMMERCE_SYNC.REINTENTAR: HTTP 403');

  await expectStatus('AUTH','/1e5/retry',400);
  httpPass('ID ambiguo/inválido: HTTP 400');

  await expectStatus('AUTH','/9223372036854775807/retry',404);
  httpPass('ID válido sin evento visible: HTTP 404');

  await expectStatus('OTHER',uri,404);
  httpPass('Usuario de otra empresa: HTTP 404');

  await expectStatus('NOACCESS',uri,404);
  httpPass('Usuario sin sucursal asignada: HTTP 404');

  await expectStatus('AUTH',`/${ids.event}`,403,'GET');
  httpPass('Permiso REINTENTAR no concede acceso a VER: HTTP 403');

  const before=await state(ids.event);
  assert.equal(before.estado,'AGOTADO');
  assert.equal(before.intentos,10);
  assert.equal(before.operation_id,marker);
  assert.equal((await auditsOf(ids.event)).length,0);

  const [a,b]=await Promise.all([request('AUTH',uri),request('AUTH',uri)]);
  const successes=[a,b].filter(x=>x.status===200);
  const conflicts=[a,b].filter(x=>x.status===409);
  assert.equal(successes.length,1,JSON.stringify([a,b]));
  assert.equal(conflicts.length,1,JSON.stringify([a,b]));
  assert.equal(successes[0].body.ok,true);
  assert.equal(successes[0].body.data.id,ids.event);
  assert.equal(successes[0].body.data.estado,'REINTENTO_MANUAL');
  httpPass('Dos POST simultáneos: un HTTP 200 y un HTTP 409');

  const after=await state(ids.event);
  assert.equal(after.estado,'REINTENTO_MANUAL');
  assert.equal(after.intentos,10);
  assert.equal(after.operation_id,marker);
  assert.equal(after.ecommerce_product_id,null);
  httpPass('Estado e intentos preservados: REINTENTO_MANUAL e intentos=10');

  await expectStatus('AUTH',uri,409);
  httpPass('Repetir autorización sobre estado incompatible: HTTP 409');

  const audits=await auditsOf(ids.event);
  assert.equal(audits.length,1,'La autorización concurrente debe generar una única auditoría.');
  assert.equal(audits[0].usuario_id,ids.authorized);
  assert.equal(audits[0].registro_id,ids.event);
  assert.equal(audits[0].accion,'UPDATE');
  assert.equal(audits[0].datos_anteriores.estado,'AGOTADO');
  assert.equal(audits[0].datos_anteriores.intentos,10);
  assert.equal(audits[0].datos_nuevos.accion,'AUTORIZAR_REINTENTO');
  assert.equal(audits[0].datos_nuevos.estado,'REINTENTO_MANUAL');
  assert.equal(audits[0].datos_nuevos.intentos,10);
  assert.equal(audits[0].datos_nuevos.operation_id,marker);
  httpPass('Auditoría exacta: un UPDATE transaccional, usuario y operation_id correctos');
}

async function main(){
  await client.connect();
  try {
    if(mode==='--cleanup-marker'){
      console.log('[M13R] RECUPERACION SOLICITADA:',marker);
      await cleanup(marker);
      return;
    }
    const before=await preflight();
    if(mode==='--preflight'){
      console.log('[M13R] PREFLIGHT APROBADO; sin escrituras.');
      return;
    }
    const ids=await createFixture();
    let error;
    try { await httpTests(ids); } catch(e){ error=e; }
    if(server){
      server.closeAllConnections?.();
      try { await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())); }
      catch(e){ if(!error) error=e; else console.error('[M13R ERROR SERVIDOR]',e); }
      server=null;
    }
    try { await cleanup(marker); } catch(e){
      if(!error) error=e;
      else console.error('[M13R ERROR DE LIMPIEZA]',e);
    }
    if(error) throw error;
    const after=await snapshot();
    assert.deepEqual(after,before,'La base no volvió al estado histórico previo.');
    pass('Conteos y huella histórica restaurados, incluyendo auditoría');
    console.log(`[M13R] HTTP ADMIN APROBADO: ${httpChecks} verificaciones.`);
  }finally{
    await client.end().catch(()=>{});
    await prisma.$disconnect().catch(()=>{});
  }
}
main().catch(error=>{
  console.error('[M13R ERROR]',error);
  if(mode==='--run'){
    console.error('[M13R MARCADOR]',marker);
    console.error('[M13R RECUPERACION] --cleanup-marker',marker);
  }
  process.exitCode=1;
});
