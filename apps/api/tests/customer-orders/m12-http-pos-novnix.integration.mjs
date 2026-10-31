/**
 * M12 phase 1: real HTTP + PostgreSQL checks on the EXISTING local pos_novnix.pos.
 * Modes: --preflight (read-only), --run (synthetic writes then ownership-checked cleanup),
 *        --cleanup-marker M12_XXXXXXXXXX (ownership-checked recovery only).
 * This is a development-only integration script, never a production test runner.
 * Stop all other POS/Ecommerce workers before --run.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';

const DB_NAME = 'pos_novnix';
const SCHEMA = 'pos';
const markerRx = /^M12_[A-F0-9]{10}$/;
function safety(condition, message) {
  if (!condition) throw new Error(`[M12 SEGURIDAD] ${message}`);
}
safety(process.env.POS_ALLOW_TEST_DB === 'SI', 'Configurar POS_ALLOW_TEST_DB=SI.');
safety(process.env.INVENTORY_SYNC_ENABLED === 'false', 'Configurar INVENTORY_SYNC_ENABLED=false.');
safety(process.env.NODE_ENV !== 'production', 'NODE_ENV=production prohibido.');
safety(typeof process.env.DATABASE_URL === 'string', 'DATABASE_URL no configurado.');
const target = new URL(process.env.DATABASE_URL);
safety(['postgresql:', 'postgres:'].includes(target.protocol), 'Solo PostgreSQL.');
safety(['127.0.0.1', 'localhost'].includes(target.hostname), 'Solo PostgreSQL local.');
safety(!target.port || target.port === '5432', 'Puerto distinto de 5432.');
safety(decodeURIComponent(target.pathname) === `/${DB_NAME}`, `Solo la base ${DB_NAME}.`);
safety(!target.searchParams.has('host'), 'Host por parámetros no admitido.');
safety(!target.searchParams.has('schema') || target.searchParams.get('schema') === SCHEMA,
  `Solo esquema ${SCHEMA}.`);
const preflightOnly = process.argv.includes('--preflight');
const runMode = process.argv.includes('--run');
const recoveryIdx = process.argv.indexOf('--cleanup-marker');
const recoveryMarker = recoveryIdx === -1 ? null : process.argv[recoveryIdx + 1];
safety([preflightOnly, runMode, recoveryIdx !== -1].filter(Boolean).length === 1,
  'Elegir exactamente: --preflight, --run o --cleanup-marker M12_XXXXXXXXXX.');
if (recoveryIdx !== -1) safety(markerRx.test(recoveryMarker ?? ''), 'Marcador inválido.');

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const marker = recoveryMarker ?? `M12_${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
const state = { connected: false, fixture: false, cleaned: false, server: null };
let passed = 0;
const pass = text => { passed++; console.log(`[PASS] ${text}`); };
const q = (sql, params = []) => db.query(sql, params);
const rows = async (sql, params = []) => (await q(sql, params)).rows;
const one = async (sql, params = []) => (await rows(sql, params))[0];
const numeric = async (sql, params = []) => Number((await one(sql, params)).n);
const insertId = async (sql, params = []) => String((await one(sql, params)).id);

async function baseline() {
  return one(`SELECT
    (SELECT count(*)::int FROM pos.empresa) AS empresas,
    (SELECT count(*)::int FROM pos.venta) AS ventas,
    (SELECT count(*)::int FROM pos.pedido_cliente) AS pedidos,
    (SELECT count(*)::int FROM pos.pedido_cliente_detalle) AS detalles,
    (SELECT count(*)::int FROM pos.movimiento_inventario) AS movimientos,
    (SELECT count(*)::int FROM pos.sincronizacion_ecommerce_inventario) AS outbox,
    (SELECT count(*)::int FROM pos.auditoria) AS auditorias`);
}
async function preflight() {
  const loc = await one(`SELECT current_database() AS db, inet_server_port() AS puerto,
    current_setting('transaction_read_only') AS readonly,
    EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='pos') AS schema_exists`);
  safety(loc.db === DB_NAME && loc.puerto === 5432 && loc.schema_exists,
    'El servidor real no corresponde a pos_novnix.pos:5432.');
  safety(loc.readonly === 'off', 'PostgreSQL está en modo solo lectura.');
  const requiredTables = ['empresa','sucursal','usuario','usuario_rol','usuario_sucursal','rol','rol_permiso',
    'permiso','cliente','producto','unidad_medida','impuesto','producto_impuesto','pedido_cliente',
    'pedido_cliente_detalle','venta','auditoria','movimiento_inventario','existencia',
    'sincronizacion_ecommerce_inventario'];
  const found = (await rows(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='pos' AND table_name=ANY($1::text[])`,[requiredTables])).map(r=>r.table_name);
  safety(requiredTables.every(t=>found.includes(t)), 'Faltan tablas POS necesarias.');
  const permissions = (await rows(`SELECT codigo FROM pos.permiso WHERE codigo=ANY($1::text[])`,
    [['PEDIDOS.VER','PEDIDOS.CREAR']])).map(r=>r.codigo);
  safety(['PEDIDOS.VER','PEDIDOS.CREAR'].every(x=>permissions.includes(x)), 'Faltan permisos PEDIDOS.');
  const triggers = (await rows(`SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pos' AND NOT t.tgisinternal
    AND c.relname=ANY($1::text[])`,[['pedido_cliente','pedido_cliente_detalle']])).map(x=>x.tgname);
  safety(['trg_pedido_cliente_actualizado','trg_pedido_cliente_detalle_importes','trg_pedido_cliente_totales']
    .every(t=>triggers.includes(t)), 'Faltan triggers comerciales del pedido.');
  const count = await baseline();
  pass(`Base ${DB_NAME}, esquema ${SCHEMA}, permisos y triggers correctos. Datos existentes: ${JSON.stringify(count)}`);
  return count;
}
async function fixture() {
  await q('BEGIN');
  try {
    await q("SET LOCAL lock_timeout='5s'");
    await q("SET LOCAL statement_timeout='20000ms'");
    const permissions = await rows(`SELECT id::text,codigo FROM pos.permiso
      WHERE codigo=ANY($1::text[])`,[['PEDIDOS.VER','PEDIDOS.CREAR']]);
    assert.equal(permissions.length, 2);
    const mainRole = await insertId(`INSERT INTO pos.rol(codigo,nombre)
      VALUES ($1,'M12 validación temporal') RETURNING id`,[`R_${marker}`]);
    const viewRole = await insertId(`INSERT INTO pos.rol(codigo,nombre)
      VALUES ($1,'M12 lectura temporal') RETURNING id`,[`RV_${marker}`]);
    for (const permission of permissions) {
      await q('INSERT INTO pos.rol_permiso(rol_id,permiso_id) VALUES ($1,$2)',[mainRole,permission.id]);
      if (permission.codigo==='PEDIDOS.VER') {
        await q('INSERT INTO pos.rol_permiso(rol_id,permiso_id) VALUES ($1,$2)',[viewRole,permission.id]);
      }
    }
    const unit = await insertId(`INSERT INTO pos.unidad_medida(codigo,nombre,permite_decimales)
      VALUES ($1,'Unidad M12 temporal',false) RETURNING id`,[`UNIT_${marker}`]);
    const A = {}, B = {};
    for (const [suffix, obj] of [['A',A],['B',B]]) {
      obj.company = await insertId(`INSERT INTO pos.empresa(razon_social,nombre_comercial)
        VALUES ($1,$1) RETURNING id`,[`${marker}_${suffix}`]);
      obj.branch = await insertId(`INSERT INTO pos.sucursal(empresa_id,codigo,nombre)
        VALUES ($1,$2,'Sucursal M12 temporal') RETURNING id`,[obj.company,`S_${marker}_${suffix}`]);
      obj.user = await insertId(`INSERT INTO pos.usuario(empresa_id,username,password_hash,nombre)
        VALUES ($1,$2,'M12_NO_LOGIN','Usuario temporal') RETURNING id`,
        [obj.company,`m12_${marker.toLowerCase()}_${suffix.toLowerCase()}`]);
      await q('INSERT INTO pos.usuario_rol(usuario_id,rol_id) VALUES ($1,$2)',[obj.user,mainRole]);
      await q('INSERT INTO pos.usuario_sucursal(usuario_id,sucursal_id) VALUES ($1,$2)',[obj.user,obj.branch]);
      obj.customer = await insertId(`INSERT INTO pos.cliente(empresa_id,codigo,nombre)
        VALUES ($1,$2,'Cliente M12 temporal') RETURNING id`,[obj.company,`CLI_${marker}_${suffix}`]);
    }
    A.otherBranch = await insertId(`INSERT INTO pos.sucursal(empresa_id,codigo,nombre)
      VALUES ($1,$2,'Sucursal M12 sin asignar') RETURNING id`,[A.company,`S_${marker}_UNASSIGNED`]);
    A.viewer = await insertId(`INSERT INTO pos.usuario(empresa_id,username,password_hash,nombre)
      VALUES ($1,$2,'M12_NO_LOGIN','Visor M12') RETURNING id`,
      [A.company,`m12_view_${marker.toLowerCase()}`]);
    await q('INSERT INTO pos.usuario_rol(usuario_id,rol_id) VALUES ($1,$2)',[A.viewer,viewRole]);
    await q('INSERT INTO pos.usuario_sucursal(usuario_id,sucursal_id) VALUES ($1,$2)',[A.viewer,A.branch]);
    A.product = await insertId(`INSERT INTO pos.producto
      (empresa_id,unidad_medida_id,sku,codigo_barras,nombre,precio_venta,costo_referencia,tipo,controla_inventario)
      VALUES ($1,$2,$3,$4,'Producto M12 temporal',100.00,40.0000,'PRODUCTO',true) RETURNING id`,
      [A.company,unit,`SKU_${marker}`,`BAR_${marker}`]);
    const tax = await insertId(`INSERT INTO pos.impuesto(empresa_id,codigo,nombre,tasa)
      VALUES ($1,$2,'IVA temporal M12',16.0000) RETURNING id`,[A.company,`TAX_${marker}`]);
    await q('INSERT INTO pos.producto_impuesto(producto_id,impuesto_id) VALUES ($1,$2)',[A.product,tax]);
    await q('COMMIT');
    state.fixture = true;
    pass(`Fixture ${marker} insertado; solo empresas y recursos sintéticos`);
    return { A,B };
  } catch (e) {
    await q('ROLLBACK').catch(()=>{});
    throw e;
  }
}

/** Refuse cleanup if ownership, expected relations, or non-test activity is ambiguous. */
async function cleanup(tag) {
  safety(markerRx.test(tag),'Marcador de limpieza incorrecto.');
  console.log(`[M12] Comprobando propiedad y referencias de ${tag} antes de limpiar.`);
  await q('BEGIN');
  try {
    await q("SET LOCAL lock_timeout='5s'");
    await q("SET LOCAL statement_timeout='20000ms'");
    const companies = await rows(`SELECT id::text, razon_social,nombre_comercial FROM pos.empresa
      WHERE razon_social=ANY($1::text[]) FOR UPDATE`,[[`${tag}_A`,`${tag}_B`]]);
    if (companies.length===0) { await q('ROLLBACK'); pass('Fixture inexistente; nada por borrar.'); return; }
    assert.equal(companies.length,2,'Marcador sin exactamente dos empresas propias.');
    const A = companies.find(x=>x.razon_social===`${tag}_A`);
    const B = companies.find(x=>x.razon_social===`${tag}_B`);
    assert.ok(A && B && A.nombre_comercial===A.razon_social && B.nombre_comercial===B.razon_social);
    const cids=[A.id,B.id];
    const branches=await rows(`SELECT id::text,empresa_id::text,codigo FROM pos.sucursal
      WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`,[cids]);
    assert.equal(branches.length,3,'Sucursales adicionales dentro del fixture.');
    for (const [empresa,codigo] of [[A.id,`S_${tag}_A`],[A.id,`S_${tag}_UNASSIGNED`],[B.id,`S_${tag}_B`]]) {
      assert.equal(branches.filter(x=>x.empresa_id===empresa&&x.codigo===codigo).length,1);
    }
    const bids=branches.map(x=>x.id);
    const ba=branches.find(x=>x.codigo===`S_${tag}_A`).id;
    const bb=branches.find(x=>x.codigo===`S_${tag}_B`).id;
    const users=await rows(`SELECT id::text,empresa_id::text,username FROM pos.usuario
      WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`,[cids]);
    assert.equal(users.length,3,'Usuarios adicionales en empresas sintéticas.');
    const names=[`m12_${tag.toLowerCase()}_a`,`m12_${tag.toLowerCase()}_b`,
      `m12_view_${tag.toLowerCase()}`];
    assert.deepEqual(users.map(x=>x.username).sort(),names.sort());
    const ua=users.find(x=>x.username===`m12_${tag.toLowerCase()}_a`);
    const ub=users.find(x=>x.username===`m12_${tag.toLowerCase()}_b`);
    const uv=users.find(x=>x.username===`m12_view_${tag.toLowerCase()}`);
    assert.ok(ua.empresa_id===A.id && ub.empresa_id===B.id && uv.empresa_id===A.id);
    const uids=users.map(x=>x.id);
    const roles=await rows(`SELECT id::text,codigo FROM pos.rol WHERE codigo=ANY($1::text[]) FOR UPDATE`,
      [[`R_${tag}`,`RV_${tag}`]]);
    assert.deepEqual(roles.map(x=>x.codigo).sort(),[`R_${tag}`,`RV_${tag}`].sort());
    const rids=roles.map(x=>x.id);
    const rolePerms=await rows(`SELECT rol_id::text,permiso_id::text FROM pos.rol_permiso
      WHERE rol_id=ANY($1::bigint[])`,[rids]);
    assert.equal(rolePerms.length,3,'Permisos añadidos al rol temporal.');
    const expectedPerms=await rows(`SELECT id::text,codigo FROM pos.permiso
      WHERE codigo=ANY($1::text[])`,[['PEDIDOS.VER','PEDIDOS.CREAR']]);
    assert.equal(expectedPerms.length,2);
    const main=roles.find(x=>x.codigo===`R_${tag}`).id;
    const viewer=roles.find(x=>x.codigo===`RV_${tag}`).id;
    assert.equal(rolePerms.filter(x=>x.rol_id===main).length,2);
    assert.deepEqual(rolePerms.filter(x=>x.rol_id===viewer).map(x=>x.permiso_id),
      expectedPerms.filter(x=>x.codigo==='PEDIDOS.VER').map(x=>x.id));
    const assignedRoles=await rows(`SELECT usuario_id::text,rol_id::text FROM pos.usuario_rol
      WHERE usuario_id=ANY($1::bigint[])`,[uids]);
    assert.equal(assignedRoles.length,3);
    assert.ok(assignedRoles.every(x=>
      (x.usuario_id===ua.id && x.rol_id===main) ||
      (x.usuario_id===ub.id && x.rol_id===main) ||
      (x.usuario_id===uv.id && x.rol_id===viewer)));
    const assignedBranches=await rows(`SELECT usuario_id::text,sucursal_id::text FROM pos.usuario_sucursal
      WHERE usuario_id=ANY($1::bigint[])`,[uids]);
    assert.equal(assignedBranches.length,3);
    assert.ok(assignedBranches.every(x=>
      (x.usuario_id===ua.id && x.sucursal_id===ba) ||
      (x.usuario_id===ub.id && x.sucursal_id===bb) ||
      (x.usuario_id===uv.id && x.sucursal_id===ba)));
    const unit=await rows('SELECT id::text,codigo FROM pos.unidad_medida WHERE codigo=$1 FOR UPDATE',
      [`UNIT_${tag}`]);
    assert.equal(unit.length,1);
    const product=await rows(`SELECT id::text,empresa_id::text,unidad_medida_id::text,sku,codigo_barras
      FROM pos.producto WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`,[cids]);
    assert.equal(product.length,1);
    const p=product[0];
    assert.ok(p.empresa_id===A.id && p.unidad_medida_id===unit[0].id &&
      p.sku===`SKU_${tag}` && p.codigo_barras===`BAR_${tag}`);
    const tax=await rows(`SELECT id::text,empresa_id::text,codigo FROM pos.impuesto
      WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`,[cids]);
    assert.equal(tax.length,1);
    assert.ok(tax[0].empresa_id===A.id && tax[0].codigo===`TAX_${tag}`);
    assert.deepEqual(await rows(`SELECT producto_id::text,impuesto_id::text FROM pos.producto_impuesto
      WHERE producto_id=$1`,[p.id]),[{producto_id:p.id,impuesto_id:tax[0].id}]);
    const customers=await rows(`SELECT id::text,empresa_id::text,codigo FROM pos.cliente
      WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`,[cids]);
    assert.equal(customers.length,2);
    for (const [cid,code] of [[A.id,`CLI_${tag}_A`],[B.id,`CLI_${tag}_B`]]) {
      assert.equal(customers.filter(x=>x.empresa_id===cid && x.codigo===code).length,1);
    }
    const customerIds=customers.map(x=>x.id);
    assert.equal(await numeric('SELECT count(*)::int AS n FROM pos.cliente_direccion WHERE cliente_id=ANY($1::bigint[])',
      [customerIds]),0,'Direcciones ajenas: detener limpieza.');
    const orders=await rows(`SELECT id::text,folio,empresa_id::text,sucursal_id::text,cliente_id::text
      FROM pos.pedido_cliente WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`,[cids]);
    const aCustomer=customers.find(x=>x.empresa_id===A.id).id;
    assert.ok(orders.every(x=>x.folio.startsWith(`${tag}_`) && x.empresa_id===A.id &&
      x.sucursal_id===ba && x.cliente_id===aCustomer),'Pedido ajeno al marcador.');
    const oids=orders.map(x=>x.id);
    const detail=await rows(`SELECT pedido_cliente_id::text,producto_id::text FROM pos.pedido_cliente_detalle
      WHERE pedido_cliente_id=ANY($1::bigint[])`,[oids]);
    assert.ok(detail.every(x=>oids.includes(x.pedido_cliente_id) && x.producto_id===p.id));
    const audits=await rows(`SELECT tabla,registro_id::text FROM pos.auditoria
      WHERE usuario_id=ANY($1::bigint[])`,[uids]);
    assert.ok(audits.every(x=>x.tabla==='pedido_cliente' && oids.includes(x.registro_id)),
      'Auditoría ajena a pedidos del fixture.');
    for (const table of ['venta','cotizacion','orden_venta','compra','transferencia_almacen',
      'proveedor','categoria','configuracion_empresa','operacion_transferencia','operacion_compra']) {
      assert.equal(await numeric(`SELECT count(*)::int AS n FROM pos.${table}
        WHERE empresa_id=ANY($1::bigint[])`,[cids]),0,`${table}: existen registros no previstos.`);
    }
    assert.equal(await numeric('SELECT count(*)::int AS n FROM pos.movimiento_inventario WHERE producto_id=$1',
      [p.id]),0,'Hay movimientos de inventario inesperados.');
    assert.equal(await numeric('SELECT count(*)::int AS n FROM pos.existencia WHERE producto_id=$1',
      [p.id]),0,'Hay existencias inesperadas.');
    assert.equal(await numeric('SELECT count(*)::int AS n FROM pos.venta WHERE pedido_cliente_id=ANY($1::bigint[])',
      [oids]),0,'Ventas vinculadas: detener limpieza.');
    assert.equal(await numeric('SELECT count(*)::int AS n FROM pos.producto_impuesto WHERE impuesto_id=$1 AND producto_id<>$2',
      [tax[0].id,p.id]),0,'Impuesto vinculado a producto ajeno.');
    assert.equal(await numeric('SELECT count(*)::int AS n FROM pos.producto WHERE unidad_medida_id=$1 AND id<>$2',
      [unit[0].id,p.id]),0,'Unidad utilizada por un producto ajeno.');
    assert.equal(await numeric('SELECT count(*)::int AS n FROM pos.auditoria WHERE registro_id=ANY($1::bigint[]) AND tabla=$2 AND (usuario_id IS NULL OR usuario_id<>ALL($3::bigint[]))',
      [oids,'pedido_cliente',uids]),0,'Auditorías ajenas vinculadas al documento.');
    // No broad predicates: all DELETEs target the fully validated synthetic IDs.
    await q('DELETE FROM pos.auditoria WHERE usuario_id=ANY($1::bigint[]) AND tabla=$2 AND registro_id=ANY($3::bigint[])',
      [uids,'pedido_cliente',oids]);
    await q('DELETE FROM pos.pedido_cliente_detalle WHERE pedido_cliente_id=ANY($1::bigint[])',[oids]);
    await q('DELETE FROM pos.pedido_cliente WHERE id=ANY($1::bigint[])',[oids]);
    await q('DELETE FROM pos.producto_impuesto WHERE producto_id=$1',[p.id]);
    await q('DELETE FROM pos.impuesto WHERE id=$1',[tax[0].id]);
    await q('DELETE FROM pos.producto WHERE id=$1',[p.id]);
    await q('DELETE FROM pos.cliente WHERE id=ANY($1::bigint[])',[customerIds]);
    await q('DELETE FROM pos.usuario_rol WHERE usuario_id=ANY($1::bigint[])',[uids]);
    await q('DELETE FROM pos.usuario_sucursal WHERE usuario_id=ANY($1::bigint[])',[uids]);
    await q('DELETE FROM pos.usuario WHERE id=ANY($1::bigint[])',[uids]);
    await q('DELETE FROM pos.sucursal WHERE id=ANY($1::bigint[])',[bids]);
    await q('DELETE FROM pos.empresa WHERE id=ANY($1::bigint[])',[cids]);
    await q('DELETE FROM pos.rol_permiso WHERE rol_id=ANY($1::bigint[])',[rids]);
    await q('DELETE FROM pos.rol WHERE id=ANY($1::bigint[])',[rids]);
    await q('DELETE FROM pos.unidad_medida WHERE id=$1',[unit[0].id]);
    assert.equal(await numeric('SELECT count(*)::int AS n FROM pos.empresa WHERE razon_social=ANY($1::text[])',
      [[`${tag}_A`,`${tag}_B`]]),0);
    await q('COMMIT');
    pass(`Limpieza de ${tag} verificada y confirmada transaccionalmente`);
  } catch(e) { await q('ROLLBACK').catch(()=>{}); throw e; }
}

async function run() {
  await db.connect(); state.connected = true;
  const countsBefore = await preflight();
  if (preflightOnly) { console.log('[M12] PRE-FLIGHT solo lectura aprobado.'); return; }
  if (recoveryMarker) { await cleanup(marker); state.cleaned = true; return; }
  const { tokenService } = await import('../../src/modules/auth/token.service.js');
  const { app } = await import('../../src/app.ts');
  console.log(`[M12] MARCADOR DE RECUPERACIÓN: ${marker}`);
  const { A,B } = await fixture();
  const token = (user, company) => tokenService.createAccessToken({ userId:BigInt(user),empresaId:BigInt(company) });
  const [a,b,viewer] = await Promise.all([token(A.user,A.company), token(B.user,B.company), token(A.viewer,A.company)]);
  state.server=app.listen(0,'127.0.0.1');
  await once(state.server,'listening');
  const host=`http://127.0.0.1:${state.server.address().port}`;
  async function request(method,path,jwt,body) {
    const resp=await fetch(host+path,{method,headers:{...(jwt?{Authorization:`Bearer ${jwt}`}:{}) ,
      ...(body!==undefined?{'Content-Type':'application/json'}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    return {status:resp.status,data:await resp.json().catch(()=>null)};
  }
  async function expect(code,method,path,jwt,body,label) {
    const r=await request(method,path,jwt,body);
    assert.equal(r.status,code,`${label}: HTTP ${r.status}, esperado ${code}: ${JSON.stringify(r.data)?.slice(0,800)}`);
    pass(`${label}: HTTP ${code}`);
    return r.data;
  }
  const prefix='/api/v1/customer-orders';
  const folio=(name)=>`${marker}_${name}`;
  const payload=(name,quantity='2',discount='10.0000')=>({
    sucursal_id:A.branch,cliente_id:A.customer,folio:folio(name),
    referencia_cliente:folio('REF'),
    detalles:[{producto_id:A.product,cantidad:quantity,descuento_porcentaje:discount}]
  });
  await expect(401,'GET',prefix,null,undefined,'JWT obligatorio');
  await expect(200,'GET',prefix,a,undefined,'Listar autenticado');
  await expect(403,'POST',prefix,viewer,payload('FORBIDDEN'),'Rol de solo lectura no crea');
  await expect(400,'POST',prefix,a,{...payload('INJECT'),empresa_id:B.company},'Inyección empresa rechazada');
  await expect(404,'POST',prefix,a,{...payload('OTHERBR'),sucursal_id:A.otherBranch},'Sucursal no asignada rechazada');
  await expect(404,'POST',prefix,a,{...payload('OTHERCO'),sucursal_id:B.branch},'Sucursal de otra empresa rechazada');
  await expect(422,'POST',prefix,a,{...payload('OTHERCUSTOMER'),cliente_id:B.customer},'Cliente de otra empresa rechazado');
  await expect(400,'POST',prefix,a,{...payload('DUPPRODUCT'),
    detalles:[{producto_id:A.product,cantidad:'1'},{producto_id:A.product,cantidad:'1'}]},'Productos duplicados rechazados');
  const order=await expect(201,'POST',prefix,a,payload('MAIN'),'Crear pedido y calcular totales');
  const orderId=order?.data?.id;
  assert.match(String(orderId),/^\d+$/);
  assert.equal(order.data.estado,'PENDIENTE');
  assert.equal(Number(order.data.total),208.80);
  const dbOrder=await one(`SELECT subtotal::text,descuento::text,impuesto::text,total::text,estado
    FROM pos.pedido_cliente WHERE id=$1`,[orderId]);
  assert.deepEqual(dbOrder,{subtotal:'200.00',descuento:'20.00',impuesto:'28.80',total:'208.80',estado:'PENDIENTE'});
  assert.equal(await numeric('SELECT count(*)::int AS n FROM pos.pedido_cliente_detalle WHERE pedido_cliente_id=$1',[orderId]),1);
  pass('PostgreSQL y triggers: totales históricos exactos (208.80)');
  await expect(409,'POST',prefix,a,payload('MAIN'),'Folio duplicado rechazado');
  await expect(404,'GET',`${prefix}/${orderId}`,b,undefined,'Aislamiento de empresa B');
  await expect(404,'PATCH',`${prefix}/${orderId}`,b,{observaciones:'Ataque'},'Escritura cruzada rechazada');
  await expect(400,'PATCH',`${prefix}/${orderId}`,a,{estado:'ENTREGADO'},'Cambio de estado inyectado rechazado');
  const edited=await expect(200,'PATCH',`${prefix}/${orderId}`,a,{referencia_cliente:'EDITADA',
    detalles:[{producto_id:A.product,cantidad:'1',descuento_porcentaje:'0.0000'}]},'Editar pedido pendiente');
  assert.equal(edited?.data?.referencia_cliente,'EDITADA');
  assert.equal(Number(edited?.data?.total),116.00);
  assert.equal((await one('SELECT total::text FROM pos.pedido_cliente WHERE id=$1',[orderId])).total,'116.00');
  pass('Edición conserva importes calculados por triggers (116.00)');
  await expect(409,'POST',`${prefix}/${orderId}/prepare`,a,{},'No preparar pedido no confirmado');
  await expect(400,'POST',`${prefix}/${orderId}/confirm`,a,{estado:'CONFIRMADO'},'No aceptar estado en cuerpo');
  const concurrent=await Promise.all([
    request('POST',`${prefix}/${orderId}/confirm`,a,{}),
    request('POST',`${prefix}/${orderId}/confirm`,a,{})
  ]);
  assert.deepEqual(concurrent.map(r=>r.status).sort((x,y)=>x-y),[200,409],
    `Resultado concurrente inesperado: ${JSON.stringify(concurrent).slice(0,800)}`);
  pass('Concurrencia de confirmación: exactamente un 200 y un 409');
  await expect(409,'PATCH',`${prefix}/${orderId}`,a,{observaciones:'Tarde'},'No editar confirmado');
  await expect(200,'POST',`${prefix}/${orderId}/prepare`,a,{},'Preparar pedido');
  await expect(200,'POST',`${prefix}/${orderId}/ready`,a,{},'Marcar pedido listo');
  await expect(200,'POST',`${prefix}/${orderId}/deliver`,a,{},'Registrar entrega');
  await expect(409,'POST',`${prefix}/${orderId}/cancel`,a,{},'No cancelar entregado');
  await expect(409,'POST',`${prefix}/${orderId}/deliver`,a,{},'Entrega duplicada rechazada');
  const cancelable=await expect(201,'POST',prefix,a,payload('CANCEL'),'Crear pedido para cancelar');
  const cancelId=cancelable?.data?.id;
  assert.match(String(cancelId),/^\d+$/);
  await expect(200,'POST',`${prefix}/${cancelId}/cancel`,a,{},'Cancelar pedido pendiente');
  await expect(409,'POST',`${prefix}/${cancelId}/confirm`,a,{},'No confirmar cancelado');
  await expect(409,'POST',`${prefix}/${cancelId}/cancel`,a,{},'Cancelar dos veces rechazado');
  const listing=await expect(200,'GET',`${prefix}?estado=ENTREGADO&page=1&pageSize=10`,a,undefined,
    'Filtrar pedidos entregados');
  assert.ok(listing?.data?.rows?.some(x=>x.id===orderId));
  const dbCounts=await one(`SELECT
    (SELECT count(*)::int FROM pos.venta WHERE pedido_cliente_id=ANY($1::bigint[])) AS ventas,
    (SELECT count(*)::int FROM pos.movimiento_inventario WHERE producto_id=$2) AS movimientos,
    (SELECT count(*)::int FROM pos.existencia WHERE producto_id=$2) AS existencias,
    (SELECT count(*)::int FROM pos.sincronizacion_ecommerce_inventario e
      JOIN pos.movimiento_inventario m ON m.id=e.movimiento_inventario_id
      WHERE m.producto_id=$2) AS outbox,
    (SELECT count(*)::int FROM pos.auditoria WHERE tabla='pedido_cliente'
      AND registro_id=ANY($1::bigint[])) AS auditorias`,[[orderId,cancelId],A.product]);
  assert.deepEqual(dbCounts,{ventas:0,movimientos:0,existencias:0,outbox:0,auditorias:8});
  pass('Sin ventas, stock, reservas, caja ni outbox; auditoría de 8 operaciones');
  console.log(`[M12] ${passed} verificaciones funcionales aprobadas; limpieza ${marker} pendiente.`);
  // The cleanup runs in finally. Check baseline there after cleanup, not before it.
  state.originalCounts = countsBefore;
}

try {
  await run();
} catch(e) {
  console.error('[M12 INTEGRACIÓN FALLIDA]',e);
  console.error(`MARCADOR: ${marker} — solo base ${DB_NAME}, esquema ${SCHEMA}.`);
  process.exitCode=1;
} finally {
  if (state.server) await new Promise(resolve=>state.server.close(resolve));
  if (state.connected && state.fixture && !state.cleaned) {
    try { await cleanup(marker); state.cleaned=true; }
    catch(e) {
      console.error('[M12 LIMPIEZA BLOQUEADA; CONSERVAR MARCADOR]',e);
      console.error(`RECUPERACIÓN: node --import tsx tests/customer-orders/m12-http-pos-novnix.integration.mjs --cleanup-marker ${marker}`);
      process.exitCode=1;
    }
  }
  if (state.connected && state.cleaned && state.originalCounts) {
    try {
      const after=await baseline();
      assert.deepEqual(after,state.originalCounts,'Los conteos globales variaron tras el fixture.');
      pass('Los conteos globales volvieron a los valores iniciales.');
    } catch(e) { console.error('[M12 ALERTA POST-LIMPIEZA]',e); process.exitCode=1; }
  }
  if (state.connected) await db.end().catch(()=>{});
  if (state.cleaned) console.log(`[M12] Limpieza completada de ${marker} en ${DB_NAME}.${SCHEMA}.`);
}
