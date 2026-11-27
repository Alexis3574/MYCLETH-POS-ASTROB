/**
 * M11 HTTP + PostgreSQL isolated integration candidate.
 * ONLY for dedicated, disposable database pos_novnix_m11_test on loopback:5432.
 * Does NOT spawn src/server.ts or Ecommerce worker.
 * Leaves fixture in disposable DB for diagnostic review; drop whole DB explicitly later.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';

const EXPECTED_DB = 'pos_novnix_m11_test';
const ASSERT_ENV = (ok, message) => { if (!ok) throw new Error(`[M11 SAFETY] ${message}`); };
ASSERT_ENV(process.env.POS_ALLOW_TEST_DB === 'SI', 'Exigir POS_ALLOW_TEST_DB=SI.');
ASSERT_ENV(process.env.INVENTORY_SYNC_ENABLED === 'false', 'Exigir INVENTORY_SYNC_ENABLED=false.');
ASSERT_ENV(process.env.NODE_ENV !== 'production', 'Prohibido NODE_ENV=production.');
ASSERT_ENV(Boolean(process.env.M11_TEST_DATABASE_URL), 'Falta M11_TEST_DATABASE_URL.');
const testUrl = new URL(process.env.M11_TEST_DATABASE_URL);
ASSERT_ENV(['postgres:', 'postgresql:'].includes(testUrl.protocol), 'URL debe ser PostgreSQL.');
ASSERT_ENV(['127.0.0.1', 'localhost'].includes(testUrl.hostname), 'Solo servidor local.');
ASSERT_ENV(!testUrl.port || testUrl.port === '5432', 'Solo puerto 5432.');
ASSERT_ENV(decodeURIComponent(testUrl.pathname) === `/${EXPECTED_DB}`, `Solo base ${EXPECTED_DB}.`);
ASSERT_ENV(!['pos_novnix', 'postgres', 'template1', 'template0'].includes(testUrl.pathname.slice(1)), 'Base no permitida.');
ASSERT_ENV(!testUrl.searchParams.has('host'), 'No permitir host por parámetros.');
// Critical: env must be set BEFORE dynamic imports of Prisma, app and token service.
process.env.DATABASE_URL = process.env.M11_TEST_DATABASE_URL;

const db = new pg.Client({ connectionString: process.env.M11_TEST_DATABASE_URL, connectionTimeoutMillis: 5000 });
const marker = `M11_${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
const preflightOnly = process.argv.includes('--preflight');
const tests = [];
const ok = message => { tests.push(message); console.log(`[PASS] ${message}`); };
const q = (sql, params = []) => db.query(sql, params);
const scalar = async (sql, params = []) => Number((await q(sql, params)).rows[0].n);
const id = async (sql, params = []) => String((await q(sql, params)).rows[0].id);
const state = { server: null, fixtureCreated: false };

async function preflight() {
  const where = (await q(`SELECT current_database() AS db, inet_server_port() AS port, current_setting('transaction_read_only') AS readonly`)).rows[0];
  ASSERT_ENV(where.db === EXPECTED_DB && where.port === 5432, 'Servidor real no coincide con base aislada.');
  ASSERT_ENV(where.readonly === 'off', 'Base de prueba está en modo solo lectura.');
  const expected = ['empresa','sucursal','usuario','rol','permiso','usuario_rol','usuario_sucursal','producto','impuesto',
    'producto_impuesto','almacen','existencia','movimiento_inventario','cotizacion','cotizacion_detalle',
    'orden_venta','orden_venta_detalle','venta','venta_detalle','venta_pago','auditoria',
    'sincronizacion_ecommerce_inventario','caja','sesion_caja','metodo_pago'];
  const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='pos'`)).rows.map(r => r.table_name);
  const missing = expected.filter(x => !tables.includes(x));
  ASSERT_ENV(missing.length === 0, `Esquema de pruebas incompleto: ${missing.join(', ')}`);
  const indexes = (await q(`SELECT indexname FROM pg_indexes WHERE schemaname='pos' AND indexname=ANY($1::text[])`,
    [['uq_orden_venta_cotizacion_id','uq_venta_orden_venta_id']])).rows.map(r => r.indexname);
  ASSERT_ENV(indexes.length === 2, 'No están los dos índices de unicidad de M11.');
  const countRows = (await q(`SELECT
    (SELECT count(*)::int FROM pos.empresa) AS empresas,
    (SELECT count(*)::int FROM pos.venta) AS ventas,
    (SELECT count(*)::int FROM pos.cotizacion) AS cotizaciones,
    (SELECT count(*)::int FROM pos.orden_venta) AS ordenes,
    (SELECT count(*)::int FROM pos.movimiento_inventario) AS movimientos`)).rows[0];
  ASSERT_ENV(Object.values(countRows).every(x => x === 0), `La base no está limpia. Conteos: ${JSON.stringify(countRows)}. NO BORRAR DATOS AUTOMÁTICAMENTE.`);
  ok(`Destino, tablas e índices confirmados: ${EXPECTED_DB}; base sin datos comerciales`);
}

async function fixture() {
  await q('BEGIN');
  try {
    const permissionCodes = ['COTIZACIONES.VER','COTIZACIONES.CREAR','ORDENES.VER','ORDENES.CREAR','VENTAS.CREAR'];
    for (const code of permissionCodes) {
      await q(`INSERT INTO pos.permiso(codigo, modulo, descripcion) VALUES ($1,$2,$3) ON CONFLICT (codigo) DO NOTHING`,
        [code, code.split('.')[0], 'Fixture M11 - base descartable']);
    }
    const allPerms = (await q(`SELECT id::text,codigo FROM pos.permiso WHERE codigo=ANY($1::text[])`,[permissionCodes])).rows;
    assert.equal(allPerms.length, permissionCodes.length);
    const mainRole = await id(`INSERT INTO pos.rol(codigo,nombre) VALUES ($1,'M11 Integración') RETURNING id`, [`R_${marker}`]);
    const viewRole = await id(`INSERT INTO pos.rol(codigo,nombre) VALUES ($1,'M11 Solo lectura') RETURNING id`, [`RV_${marker}`]);
    for (const perm of allPerms) {
      await q('INSERT INTO pos.rol_permiso(rol_id,permiso_id) VALUES ($1,$2)',[mainRole,perm.id]);
      if (perm.codigo === 'ORDENES.VER') await q('INSERT INTO pos.rol_permiso(rol_id,permiso_id) VALUES ($1,$2)',[viewRole,perm.id]);
    }
    const unit = await id(`INSERT INTO pos.unidad_medida(codigo,nombre,permite_decimales)
      VALUES ($1,'M11 unidad de prueba',false) RETURNING id`,[`UNIT_${marker}`]);
    const method = await id(`INSERT INTO pos.metodo_pago(codigo,nombre,es_efectivo)
      VALUES ($1,'M11 transferencia',false) RETURNING id`,[`PAY_${marker}`]);
    const cashMethod = await id(`INSERT INTO pos.metodo_pago(codigo,nombre,es_efectivo)
      VALUES ($1,'M11 efectivo',true) RETURNING id`,[`CASH_${marker}`]);

    const a = {}; const b = {};
    for (const [suffix,obj] of [['A',a],['B',b]]) {
      obj.company = await id(`INSERT INTO pos.empresa(razon_social,nombre_comercial) VALUES ($1,$1) RETURNING id`,[`${marker}_${suffix}`]);
      obj.branch = await id(`INSERT INTO pos.sucursal(empresa_id,codigo,nombre) VALUES ($1,$2,'Sucursal M11') RETURNING id`,[obj.company,`S_${marker}_${suffix}`]);
      obj.warehouse = await id(`INSERT INTO pos.almacen(sucursal_id,codigo,nombre) VALUES ($1,$2,'Almacén M11') RETURNING id`,[obj.branch,`ALM_${suffix}`]);
      obj.user = await id(`INSERT INTO pos.usuario(empresa_id,username,password_hash,nombre) VALUES ($1,$2,'M11_NO_LOGIN','M11') RETURNING id`,
        [obj.company,`m11_${marker.toLowerCase()}_${suffix.toLowerCase()}`]);
      await q('INSERT INTO pos.usuario_rol(usuario_id,rol_id) VALUES ($1,$2)',[obj.user,mainRole]);
      await q('INSERT INTO pos.usuario_sucursal(usuario_id,sucursal_id) VALUES ($1,$2)',[obj.user,obj.branch]);
    }
    a.viewer = await id(`INSERT INTO pos.usuario(empresa_id,username,password_hash,nombre) VALUES ($1,$2,'M11_NO_LOGIN','Visor M11') RETURNING id`,
      [a.company,`m11_view_${marker.toLowerCase()}`]);
    await q('INSERT INTO pos.usuario_rol(usuario_id,rol_id) VALUES ($1,$2)',[a.viewer,viewRole]);
    await q('INSERT INTO pos.usuario_sucursal(usuario_id,sucursal_id) VALUES ($1,$2)',[a.viewer,a.branch]);
    a.customer = await id(`INSERT INTO pos.cliente(empresa_id,codigo,nombre) VALUES ($1,$2,'Cliente M11') RETURNING id`,[a.company,`CLI_${marker}`]);
    a.product = await id(`INSERT INTO pos.producto(empresa_id,unidad_medida_id,sku,codigo_barras,nombre,precio_venta,costo_referencia,tipo,controla_inventario)
      VALUES ($1,$2,$3,$4,'Producto inventariable M11',100.00,40.0000,'PRODUCTO',true) RETURNING id`,
      [a.company,unit,`SKU_${marker}`,`BAR_${marker}`]);
    const tax = await id(`INSERT INTO pos.impuesto(empresa_id,codigo,nombre,tasa) VALUES ($1,$2,'IVA M11',16.0000) RETURNING id`,[a.company,`TAX_${marker}`]);
    await q('INSERT INTO pos.producto_impuesto(producto_id,impuesto_id) VALUES ($1,$2)',[a.product,tax]);
    a.cash = await id(`INSERT INTO pos.caja(sucursal_id,codigo,nombre) VALUES ($1,$2,'Caja M11') RETURNING id`,[a.branch,`C_${marker}`]);
    a.session = await id(`INSERT INTO pos.sesion_caja(caja_id,usuario_apertura_id,monto_apertura) VALUES ($1,$2,500.00) RETURNING id`,[a.cash,a.user]);
    await q(`INSERT INTO pos.movimiento_inventario(producto_id,almacen_id,usuario_id,tipo,cantidad,costo_unitario,documento_tipo,motivo)
      VALUES ($1,$2,$3,'AJUSTE_POSITIVO',10.000,40.0000,'PRUEBA_M11','Stock sintético aislado')`,[a.product,a.warehouse,a.user]);
    await q('COMMIT');
    state.fixtureCreated = true;
    ok(`Fixture sintético ${marker} confirmado SOLO en base aislada`);
    return { a,b,method,cashMethod };
  } catch (error) {
    await q('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  await db.connect();
  await preflight();
  if (preflightOnly) { console.log('[M11] PRE-FLIGHT aprobado; sin modificaciones.'); return; }

  const { tokenService } = await import('../../src/modules/auth/token.service.js');
  const { app } = await import('../../src/app.ts');
  const f = await fixture();
  const token = async (user, company) => tokenService.createAccessToken({userId:BigInt(user),empresaId:BigInt(company)});
  const [a,b,view] = await Promise.all([token(f.a.user,f.a.company),token(f.b.user,f.b.company),token(f.a.viewer,f.a.company)]);
  state.server = app.listen(0,'127.0.0.1');
  await once(state.server,'listening');
  const origin = `http://127.0.0.1:${state.server.address().port}`;
  async function request(method,path,jwt,body) {
    const res = await fetch(origin + path, {method,headers:{ ...(jwt?{Authorization:`Bearer ${jwt}`}:{}) ,
      ...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),
      signal:AbortSignal.timeout(30000)});
    const data = await res.json().catch(()=>null);
    return {status:res.status,data};
  }
  async function expect(code,method,path,jwt,body,label) {
    const r=await request(method,path,jwt,body);
    assert.equal(r.status,code,`${label} -> ${r.status}, esperado ${code}: ${JSON.stringify(r.data)?.slice(0,700)}`);
    ok(`${label}: HTTP ${code}`);
    return r.data;
  }
  const folio = name => `${marker}_${name}`;
  await expect(401,'GET','/api/v1/sales-orders',null,undefined,'JWT requerido');
  await expect(200,'GET','/api/v1/sales-orders',a,undefined,'Lista autenticada');
  await expect(403,'POST','/api/v1/sales-orders',view,{sucursal_id:f.a.branch,folio:folio('FORB'),detalles:[{producto_id:f.a.product,cantidad:'1'}]},'Solo lectura no crea');
  await expect(400,'POST','/api/v1/sales-orders',a,{empresa_id:f.b.company,sucursal_id:f.a.branch,folio:folio('INJ'),detalles:[{producto_id:f.a.product,cantidad:'1'}]},'Empresa inyectada rechazada');

  const quote = await expect(201,'POST','/api/v1/quotes',a,{sucursal_id:f.a.branch,cliente_id:f.a.customer,
    folio:folio('QUOTE'),detalles:[{producto_id:f.a.product,cantidad:'2.000',descuento_porcentaje:'10.0000'}]},'Crear cotización');
  const quoteId=quote?.data?.id;
  assert.match(String(quoteId),/^\d+$/);
  assert.equal(Number(quote.data.total),208.80,'Total esperado 208.80');
  await expect(200,'POST',`/api/v1/quotes/${quoteId}/send`,a,{},'Enviar cotización');
  await expect(200,'POST',`/api/v1/quotes/${quoteId}/accept`,a,{},'Aceptar cotización');
  const order = await expect(201,'POST',`/api/v1/quotes/${quoteId}/convert-to-order`,a,{folio:folio('ORDER')},'Cotización → orden');
  const orderId=order?.data?.id;
  assert.match(String(orderId),/^\d+$/);
  assert.equal(order.data.estado,'PENDIENTE');
  assert.equal(Number(order.data.total),208.80);
  await expect(404,'GET',`/api/v1/sales-orders/${orderId}`,b,undefined,'Aislamiento empresa B');
  const replay = await expect(201,'POST',`/api/v1/quotes/${quoteId}/convert-to-order`,a,{folio:folio('ORDER')},'Reintento cotización → orden');
  assert.equal(replay.data.id,orderId,'Debe devolver la misma orden');
  await expect(409,'POST',`/api/v1/quotes/${quoteId}/convert-to-order`,a,{folio:folio('OTHER')},'Reintento con folio distinto');
  await expect(200,'POST',`/api/v1/sales-orders/${orderId}/start`,a,{},'Orden en proceso');
  await expect(200,'POST',`/api/v1/sales-orders/${orderId}/ready`,a,{},'Orden lista');
  await expect(409,'POST',`/api/v1/sales-orders/${orderId}/cancel`,a,{},'No cancelar orden LISTA');

  const salePayload = {folio:folio('SALE'),almacen_id:f.a.warehouse,pagos:[{metodo_pago_id:f.method,monto:'208.80'}]};
  const results = await Promise.all(Array.from({length:2},()=>request('POST',`/api/v1/sales-orders/${orderId}/convert-to-sale`,a,salePayload)));
  const statuses = results.map(x=>x.status).sort((x,y)=>x-y);
  assert.deepEqual(statuses,[201,409],`Concurrencia: ${JSON.stringify(results).slice(0,800)}`);
  const first=results.find(x=>x.status===201);
  const saleId=first?.data?.data?.id;
  assert.match(String(saleId),/^\d+$/);
  ok('Concurrencia: exactamente una venta 201 y una solicitud rechazada 409');
  await expect(409,'POST',`/api/v1/sales-orders/${orderId}/convert-to-sale`,a,salePayload,'Reintento de venta rechazado');
  await expect(409,'POST',`/api/v1/sales-orders/${orderId}/cancel`,a,{},'No cancelar orden con venta');

  const counts= (await q(`SELECT
    (SELECT count(*)::int FROM pos.orden_venta WHERE cotizacion_id=$1) AS ordenes,
    (SELECT count(*)::int FROM pos.venta WHERE orden_venta_id=$2) AS ventas,
    (SELECT count(*)::int FROM pos.venta_pago WHERE venta_id=$3) AS pagos,
    (SELECT count(*)::int FROM pos.movimiento_inventario WHERE documento_tipo='VENTA' AND documento_id=$3) AS salidas,
    (SELECT count(*)::int FROM pos.sincronizacion_ecommerce_inventario e JOIN pos.movimiento_inventario m ON m.id=e.movimiento_inventario_id WHERE m.documento_tipo='VENTA' AND m.documento_id=$3) AS outbox`,
    [quoteId,orderId,saleId])).rows[0];
  assert.deepEqual(counts,{ordenes:1,ventas:1,pagos:1,salidas:1,outbox:1});
  const saved=(await q(`SELECT subtotal::text,descuento::text,impuesto::text,total::text,estado FROM pos.venta WHERE id=$1`,[saleId])).rows[0];
  assert.deepEqual(saved,{subtotal:'200.00',descuento:'20.00',impuesto:'28.80',total:'208.80',estado:'COMPLETADA'});
  const stock=(await q('SELECT cantidad::text FROM pos.existencia WHERE producto_id=$1 AND almacen_id=$2',
    [f.a.product,f.a.warehouse])).rows[0];
  assert.equal(stock?.cantidad,'8.000');
  ok('PostgreSQL: histórico, 1 orden/venta/pago/salida/outbox, stock 8.000');

  const second = await expect(201,'POST','/api/v1/sales-orders',a,{sucursal_id:f.a.branch,folio:folio('ORDER2'),
    detalles:[{producto_id:f.a.product,cantidad:'1'}]},'Crear orden independiente');
  const secondId=second?.data?.id;
  await expect(200,'POST',`/api/v1/sales-orders/${secondId}/start`,a,{},'Iniciar segunda');
  await expect(200,'POST',`/api/v1/sales-orders/${secondId}/ready`,a,{},'Segunda lista');
  await expect(422,'POST',`/api/v1/sales-orders/${secondId}/convert-to-sale`,a,{folio:folio('BAD'),
    almacen_id:f.a.warehouse,pagos:[{metodo_pago_id:f.method,monto:'1.00'}]},'Pago insuficiente rechazado');
  assert.equal(await scalar('SELECT count(*)::int AS n FROM pos.venta WHERE empresa_id=$1',[f.a.company]),1);
  assert.equal(await scalar(`SELECT count(*)::int AS n FROM pos.movimiento_inventario WHERE documento_tipo='VENTA' AND producto_id=$1`,[f.a.product]),1);
  ok('Fallo transaccional: sin venta ni salida adicionales');

  const goodCash = await expect(201,'POST',`/api/v1/sales-orders/${secondId}/convert-to-sale`,a,{
    folio:folio('SALEC'),almacen_id:f.a.warehouse,sesion_caja_id:f.a.session,
    pagos:[{metodo_pago_id:f.cashMethod,monto:'116.00'}]},'Venta con efectivo y caja');
  const cashSaleId=goodCash?.data?.id;
  assert.equal(await scalar('SELECT count(*)::int AS n FROM pos.venta_pago WHERE venta_id=$1',[cashSaleId]),1);
  assert.equal(await scalar('SELECT count(*)::int AS n FROM pos.movimiento_caja WHERE sesion_caja_id=$1',[f.a.session]),1);
  assert.equal(await scalar(`SELECT count(*)::int AS n FROM pos.sincronizacion_ecommerce_inventario e JOIN pos.movimiento_inventario m ON m.id=e.movimiento_inventario_id WHERE m.documento_tipo='VENTA' AND m.producto_id=$1`,[f.a.product]),2);
  const finalStock=(await q('SELECT cantidad::text FROM pos.existencia WHERE producto_id=$1 AND almacen_id=$2',
    [f.a.product,f.a.warehouse])).rows[0];
  assert.equal(finalStock?.cantidad,'7.000');
  ok('Caja, segunda venta, salida y outbox correctos; stock 7.000');
  console.log(`[M11] APROBADO: ${tests.length} verificaciones. Fixture ${marker} retenido en base descartable.`);
}

try {
  await main();
} catch (error) {
  console.error('[M11 INTEGRACIÓN FALLIDA]',error);
  console.error(`MARCADOR: ${marker}; solo DB ${EXPECTED_DB}. No ejecutar limpieza sobre otras bases.`);
  process.exitCode=1;
} finally {
  if (state.server) await new Promise(resolve=>state.server.close(resolve));
  await db.end().catch(()=>{});
  if (state.fixtureCreated) console.log(`[M11] Datos sintéticos permanecen en ${EXPECTED_DB} para auditoría; eliminar SOLO descartando esa base de pruebas.`);
}
