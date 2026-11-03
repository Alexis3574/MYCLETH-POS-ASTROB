/**
 * M13 manual retry integration against local pos_novnix (schema pos).
 * Usage: node --import tsx tests/ecommerce-sync/m13-manual-retry-pos-novnix.integration.mjs --preflight
 *        node --import tsx tests/ecommerce-sync/m13-manual-retry-pos-novnix.integration.mjs --run
 *        node --import tsx tests/ecommerce-sync/m13-manual-retry-pos-novnix.integration.mjs --cleanup-marker M13M_XXXXXXXXXX
 * Creates only synthetic fixtures. Invokes repository/service methods, never Ecommerce API.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { prisma } from '../../src/lib/prisma.js';
import { inventorySyncRepository as repo } from '../../src/modules/inventory-sync/inventory-sync.repository.js';
import { ecommerceSyncRetryService } from '../../src/modules/ecommerce-sync/services/ecommerce-sync.retry.service.js';

const mode = process.argv[2];
const markerRx = /^M13M_[A-F0-9]{10}$/;
const marker = mode === '--cleanup-marker' ? process.argv[3] :
  `M13M_${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;

function guard(ok, reason) {
  if (!ok) throw new Error(`[M13M SEGURIDAD] ${reason}`);
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

const tables = [
  'unidad_medida', 'empresa', 'sucursal', 'almacen', 'producto', 'usuario',
  'usuario_sucursal', 'movimiento_inventario', 'existencia',
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
  return { counts, fingerprint, active };
}
async function preflight() {
  const before = await snapshot();
  guard(before.active === 0, `Hay ${before.active} eventos históricos no sincronizados; se cancela.`);
  const existing = await one(`SELECT count(*)::int AS n FROM pos.empresa
    WHERE left(razon_social,5) = 'M13M_'`);
  guard(existing.n === 0, 'Existen fixtures M13M sin recuperar; revisar primero.');
  console.log('[M13M] PREFLIGHT:', JSON.stringify({
    outbox: before.counts.sincronizacion_ecommerce_inventario,
    eventos_no_sincronizados: before.active,
    auditoria: before.counts.auditoria,
    fingerprint: before.fingerprint.slice(0,16)
  }));
  return before;
}

async function createFixture() {
  console.log('[M13M] MARCADOR DE RECUPERACION:', marker);
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
    const newUser = (companyId, prefix) => insertId(`INSERT INTO pos.usuario
      (empresa_id,username,password_hash,nombre,activo,bloqueado)
      VALUES ($1,$2,'M13M_FIXTURE_NOT_FOR_LOGIN',$3,true,false) RETURNING id::text`,
      [companyId,`${prefix}_${marker}`,`Usuario ${prefix} ${marker}`]);
    const authorized = await newUser(company,'AUTH');
    const unassigned = await newUser(company,'NOACCESS');
    const otherUser = await newUser(otherCompany,'OTHER');
    await query(`INSERT INTO pos.usuario_sucursal(usuario_id,sucursal_id,es_predeterminada)
      VALUES ($1,$2,true)`, [authorized,branch]);
    const movement = await insertId(`INSERT INTO pos.movimiento_inventario
      (producto_id,almacen_id,tipo,cantidad,costo_unitario,documento_tipo,motivo)
      VALUES ($1,$2,'ENTRADA',1.000,0.0000,'TEST_M13M',$3) RETURNING id::text`,
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
    return { unit,company,otherCompany,branch,warehouse,product,authorized,unassigned,otherUser,movement,event };
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
      await query('ROLLBACK');
      console.log('[M13M] Marcador inexistente: sin filas propias para limpiar.');
      return;
    }
    assert.equal(companies.length,2,'Empresas sintéticas ausentes o duplicadas.');
    assert.equal(units.length,1,'Unidad sintética ausente.');
    const company = companies.find(x=>x.razon_social===tag);
    const alt = companies.find(x=>x.razon_social===`${tag}_ALT`);
    assert.ok(company && alt);
    for(const c of companies) assert.equal(c.nombre_comercial,c.razon_social);
    const unit=units[0]; assert.equal(unit.nombre,`Unidad ${tag}`);
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
    const users=await rows(`SELECT id::text,username,empresa_id::text FROM pos.usuario
      WHERE empresa_id IN ($1,$2) FOR UPDATE`,[company.id,alt.id]);
    assert.equal(users.length,3,'Usuarios de fixture inesperados.');
    const auth=users.find(x=>x.username===`AUTH_${tag}` && x.empresa_id===company.id);
    const noaccess=users.find(x=>x.username===`NOACCESS_${tag}` && x.empresa_id===company.id);
    const other=users.find(x=>x.username===`OTHER_${tag}` && x.empresa_id===alt.id);
    assert.ok(auth && noaccess && other,'Identidades sintéticas no coinciden.');
    const assignments=await rows(`SELECT usuario_id::text,sucursal_id::text
      FROM pos.usuario_sucursal WHERE usuario_id=ANY($1::bigint[])`,[users.map(x=>x.id)]);
    assert.equal(assignments.length,1);assert.equal(assignments[0].usuario_id,auth.id);
    assert.equal(assignments[0].sucursal_id,branch.id);
    const movements=await rows(`SELECT id::text,almacen_id::text,tipo,cantidad::text,documento_tipo,motivo
      FROM pos.movimiento_inventario WHERE producto_id=$1 FOR UPDATE`,[product.id]);
    assert.equal(movements.length,1);const movement=movements[0];
    assert.equal(movement.almacen_id,warehouse.id);assert.equal(movement.tipo,'ENTRADA');
    assert.equal(Number(movement.cantidad),1);assert.equal(movement.documento_tipo,'TEST_M13M');
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
    assert.ok(event.ultimo_error===null || event.ultimo_error.startsWith('M13M_TEST_'));
    const stocks=await rows(`SELECT producto_id::text,almacen_id::text,cantidad::text,reservado::text
      FROM pos.existencia WHERE producto_id=$1 OR almacen_id=$2 FOR UPDATE`,[product.id,warehouse.id]);
    assert.equal(stocks.length,1); assert.equal(stocks[0].producto_id,product.id);
    assert.equal(stocks[0].almacen_id,warehouse.id); assert.equal(Number(stocks[0].cantidad),1);
    assert.equal(Number(stocks[0].reservado),0);
    const audits=await rows(`SELECT id::text,usuario_id::text,tabla,registro_id::text,accion,datos_nuevos
      FROM pos.auditoria WHERE tabla='sincronizacion_ecommerce_inventario' AND registro_id=$1 FOR UPDATE`,[event.id]);
    assert.ok(audits.length<=3,'Auditorías adicionales detectadas.');
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
    await remove(`DELETE FROM pos.usuario_sucursal WHERE usuario_id=$1 AND sucursal_id=$2`,[auth.id,branch.id],1);
    await remove(`DELETE FROM pos.sincronizacion_ecommerce_inventario WHERE id=$1 AND operation_id=$2`,[event.id,tag],1);
    await remove(`DELETE FROM pos.existencia WHERE producto_id=$1 AND almacen_id=$2`,[product.id,warehouse.id],1);
    await remove(`DELETE FROM pos.movimiento_inventario WHERE id=$1 AND motivo=$2`,[movement.id,tag],1);
    await remove(`DELETE FROM pos.producto WHERE id=$1 AND sku=$2`,[product.id,`SKU_${tag}`],1);
    for(const u of users) await remove(`DELETE FROM pos.usuario WHERE id=$1 AND username=$2`,[u.id,u.username],1);
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
  return one(`SELECT id::text,operation_id,estado,intentos,ultimo_error,
    ecommerce_product_id::text,sincronizado_en::text FROM pos.sincronizacion_ecommerce_inventario
    WHERE id=$1 AND operation_id=$2`,[id,marker]);
}
async function auditCount(id) {
  return Number((await one(`SELECT count(*)::int AS n FROM pos.auditoria
    WHERE tabla='sincronizacion_ecommerce_inventario' AND registro_id=$1`,[id])).n);
}
async function expectError(task,status){
  await assert.rejects(task, error => error?.status===status);
}
async function tests(ids) {
  const eventId=BigInt(ids.event);
  const actor={userId:BigInt(ids.authorized),empresaId:BigInt(ids.company)};
  const unassigned={userId:BigInt(ids.unassigned),empresaId:BigInt(ids.company)};
  const other={userId:BigInt(ids.otherUser),empresaId:BigInt(ids.otherCompany)};
  const first=await Promise.allSettled([
    ecommerceSyncRetryService.authorize(actor,eventId),
    ecommerceSyncRetryService.authorize(actor,eventId)
  ]);
  const good=first.filter(x=>x.status==='fulfilled');
  const bad=first.filter(x=>x.status==='rejected');
  assert.equal(good.length,1);assert.equal(bad.length,1);
  assert.equal(bad[0].reason?.status,409);
  assert.equal(good[0].value.estado,'REINTENTO_MANUAL');
  assert.equal((await state(ids.event)).intentos,10);
  assert.equal(await auditCount(ids.event),1);
  pass('Dos autorizaciones simultáneas: una sola transición y una auditoría');

  await expectError(ecommerceSyncRetryService.authorize(other,eventId),404);
  await expectError(ecommerceSyncRetryService.authorize(unassigned,eventId),404);
  assert.equal(await auditCount(ids.event),1);
  pass('Aislamiento multiempresa y sucursal sin acceso: 404');

  const claimed=await Promise.all([repo.tryClaim(eventId),repo.tryClaim(eventId)]);
  assert.equal(claimed.filter(x=>x.count===1).length,1);
  assert.deepEqual(claimed.find(x=>x.count===1),{count:1,attempts:11,mode:'MANUAL'});
  assert.equal((await state(ids.event)).estado,'PROCESANDO_MANUAL');
  assert.equal((await state(ids.event)).operation_id,marker);
  pass('Dos reclamaciones manuales: una sola, con intento 11 y operation_id original');

  assert.equal((await repo.markFailed(eventId,'M13M_TEST_AUTO_FORBIDDEN',11,'AUTO')).count,0);
  assert.equal((await repo.markSynchronized(eventId,987654321n,11,'AUTO')).count,0);
  assert.equal((await repo.markFailed(eventId,'M13M_TEST_FAIL_1',11,'MANUAL')).count,1);
  assert.equal((await state(ids.event)).estado,'AGOTADO');
  assert.equal((await state(ids.event)).intentos,11);
  assert.equal((await repo.tryClaim(eventId)).count,0);
  pass('Modo AUTO rechazado; fallo manual vuelve a AGOTADO sin reintentar');

  const second=await ecommerceSyncRetryService.authorize(actor,eventId);
  assert.equal(second.estado,'REINTENTO_MANUAL');
  assert.equal(second.intentos,11);
  assert.equal(await auditCount(ids.event),2);
  assert.deepEqual(await repo.tryClaim(eventId),{count:1,attempts:12,mode:'MANUAL'});
  await query(`UPDATE pos.sincronizacion_ecommerce_inventario
    SET ultimo_intento_en=NOW()-INTERVAL '1 hour'
    WHERE id=$1 AND operation_id=$2 AND estado='PROCESANDO_MANUAL'`,[ids.event,marker]);
  const recovered=await repo.requeueStaleProcessing(new Date(Date.now()-60000));
  assert.ok(recovered.exhausted>=1);
  assert.equal((await state(ids.event)).estado,'AGOTADO');
  assert.equal((await state(ids.event)).intentos,12);
  assert.equal((await repo.markFailed(eventId,'M13M_TEST_STALE',12,'MANUAL')).count,0);
  assert.equal((await repo.markSynchronized(eventId,987654321n,12,'MANUAL')).count,0);
  assert.equal((await repo.tryClaim(eventId)).count,0);
  pass('Timeout manual => AGOTADO; finalizaciones tardías rechazadas');

  const third=await ecommerceSyncRetryService.authorize(actor,eventId);
  assert.equal(third.intentos,12);
  assert.equal(await auditCount(ids.event),3);
  assert.deepEqual(await repo.tryClaim(eventId),{count:1,attempts:13,mode:'MANUAL'});
  assert.equal((await repo.markSynchronized(eventId,987654321n,13,'MANUAL')).count,1);
  const end=await state(ids.event);
  assert.equal(end.estado,'SINCRONIZADO');
  assert.equal(end.intentos,13);
  assert.equal(end.operation_id,marker);
  assert.equal(end.ecommerce_product_id,'987654321');
  assert.ok(end.sincronizado_en);
  assert.equal((await repo.markFailed(eventId,'M13M_TEST_STALE',13,'MANUAL')).count,0);
  pass('Éxito manual => SINCRONIZADO, auditoría y contador preservados');
}

async function main(){
  await client.connect();
  try {
    if(mode==='--cleanup-marker'){
      console.log('[M13M] RECUPERACION SOLICITADA:',marker);
      await cleanup(marker);
      return;
    }
    const before=await preflight();
    if(mode==='--preflight'){
      console.log('[M13M] PREFLIGHT APROBADO; sin escrituras.');
      return;
    }
    const ids=await createFixture();
    let error;
    try { await tests(ids); } catch(e){ error=e; }
    try { await cleanup(marker); } catch(e){
      if(!error) error=e;
      else console.error('[M13M ERROR DE LIMPIEZA]',e);
    }
    if(error) throw error;
    const after=await snapshot();
    assert.deepEqual(after,before,'La base no volvió al estado histórico previo.');
    pass('Conteos y huella histórica restaurados, incluyendo auditoría');
    console.log('[M13M] PRUEBAS MANUALES APROBADAS: 6 verificaciones.');
  }finally{
    await client.end().catch(()=>{});
    await prisma.$disconnect().catch(()=>{});
  }
}
main().catch(error=>{
  console.error('[M13M ERROR]',error);
  if(mode==='--run'){
    console.error('[M13M MARCADOR]',marker);
    console.error('[M13M RECUPERACION] --cleanup-marker',marker);
  }
  process.exitCode=1;
});
