/**
 * M11 — HTTP + PostgreSQL integration in existing local database pos_novnix,
 * schema pos. No other database or schema is created.
 * Synthetic fixtures are owned by unique M11_<hex> markers, validated and
 * removed transactionally after the test. No Ecommerce worker is started.
 * IMPORTANT: stop all other Ecommerce workers connected to this database.
 * Modes: --preflight (read-only), --run (write+clean), --cleanup-marker M11_XXXXXXXXXX.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';

const EXPECTED_DB = 'pos_novnix';
const EXPECTED_SCHEMA = 'pos';
const ASSERT_ENV = (ok, message) => { if (!ok) throw new Error(`[M11 SAFETY] ${message}`); };
ASSERT_ENV(process.env.POS_ALLOW_TEST_DB === 'SI', 'Exigir POS_ALLOW_TEST_DB=SI.');
ASSERT_ENV(process.env.INVENTORY_SYNC_ENABLED === 'false', 'Exigir INVENTORY_SYNC_ENABLED=false.');
ASSERT_ENV(process.env.NODE_ENV !== 'production', 'Prohibido NODE_ENV=production.');
ASSERT_ENV(Boolean(process.env.DATABASE_URL), 'Falta DATABASE_URL en .env.');
const testUrl = new URL(process.env.DATABASE_URL);
ASSERT_ENV(['postgres:', 'postgresql:'].includes(testUrl.protocol), 'URL debe ser PostgreSQL.');
ASSERT_ENV(['127.0.0.1', 'localhost'].includes(testUrl.hostname), 'Solo servidor local.');
ASSERT_ENV(!testUrl.port || testUrl.port === '5432', 'Solo puerto 5432.');
ASSERT_ENV(decodeURIComponent(testUrl.pathname) === `/${EXPECTED_DB}`, `Solo base ${EXPECTED_DB}.`);
ASSERT_ENV(!testUrl.searchParams.has('host'), 'No permitir host por parámetros.');
ASSERT_ENV(!testUrl.searchParams.has('schema') || testUrl.searchParams.get('schema') === EXPECTED_SCHEMA,
  'Solo el esquema pos es válido.');
const preflightOnly = process.argv.includes('--preflight');
const runMode = process.argv.includes('--run');
const recoveryIndex = process.argv.indexOf('--cleanup-marker');
const recoveryMarker = recoveryIndex === -1 ? null : process.argv[recoveryIndex + 1];
ASSERT_ENV([preflightOnly, runMode, recoveryMarker !== null].filter(Boolean).length === 1,
  'Elegir exactamente un modo: --preflight, --run o --cleanup-marker M11_XXXXXXXXXX.');
if (recoveryMarker !== null) ASSERT_ENV(/^M11_[A-F0-9]{10}$/.test(recoveryMarker), 'Marcador de limpieza inválido.');

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const marker = recoveryMarker || `M11_${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
const tests = [];
const ok = message => { tests.push(message); console.log(`[PASS] ${message}`); };
const q = (sql, params = []) => db.query(sql, params);
const scalar = async (sql, params = []) => Number((await q(sql, params)).rows[0].n);
const id = async (sql, params = []) => String((await q(sql, params)).rows[0].id);
const state = { server: null, fixtureCreated: false, connected: false, cleaned: false };

async function preflight() {
  const where = (await q(`SELECT current_database() AS db, inet_server_port() AS port,
    current_setting('transaction_read_only') AS readonly,
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='pos') AS schema_exists`)).rows[0];
  ASSERT_ENV(where.db === EXPECTED_DB && where.port === 5432 && where.schema_exists,
    'Servidor/base/esquema reales no coinciden con pos_novnix/pos.');
  ASSERT_ENV(where.readonly === 'off', 'Base de desarrollo está en modo solo lectura.');
  const expected = ['empresa','sucursal','usuario','rol','permiso','usuario_rol','usuario_sucursal',
    'producto','impuesto','producto_impuesto','almacen','existencia','movimiento_inventario',
    'cotizacion','cotizacion_detalle','orden_venta','orden_venta_detalle','venta','venta_detalle',
    'venta_pago','auditoria','sincronizacion_ecommerce_inventario','caja','sesion_caja',
    'metodo_pago','cliente','movimiento_caja','unidad_medida'];
  const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='pos'`)).rows.map(r => r.table_name);
  const missing = expected.filter(x => !tables.includes(x));
  ASSERT_ENV(missing.length === 0, `Esquema pos incompleto: ${missing.join(', ')}`);
  const indexes = (await q(`SELECT indexname FROM pg_indexes WHERE schemaname='pos' AND indexname=ANY($1::text[])`,
    [['uq_orden_venta_cotizacion_id','uq_venta_orden_venta_id']])).rows.map(r => r.indexname);
  ASSERT_ENV(indexes.length === 2, 'No están los dos índices de unicidad del M11.');
  const permissionCodes = ['COTIZACIONES.VER','COTIZACIONES.CREAR','ORDENES.VER','ORDENES.CREAR','VENTAS.CREAR'];
  const perms = (await q(`SELECT codigo FROM pos.permiso WHERE codigo=ANY($1::text[])`, [permissionCodes])).rows.map(x => x.codigo);
  ASSERT_ENV(permissionCodes.every(code => perms.includes(code)), 'Faltan permisos RBAC necesarios; no se alteran permisos globales.');
  const counts = (await q(`SELECT (SELECT count(*)::int FROM pos.empresa) AS empresas,
    (SELECT count(*)::int FROM pos.venta) AS ventas,
    (SELECT count(*)::int FROM pos.cotizacion) AS cotizaciones,
    (SELECT count(*)::int FROM pos.orden_venta) AS ordenes`)).rows[0];
  ok(`Destino verificado: ${EXPECTED_DB}, esquema ${EXPECTED_SCHEMA}, índices y permisos presentes; datos existentes intactos (${JSON.stringify(counts)})`);
}

async function fixture() {
  await q('BEGIN');
  try {
    const permissionCodes = ['COTIZACIONES.VER','COTIZACIONES.CREAR','ORDENES.VER','ORDENES.CREAR','VENTAS.CREAR'];
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
    ok(`Fixture sintético ${marker} confirmado en ${EXPECTED_DB}.${EXPECTED_SCHEMA}`);
    return { a,b,method,cashMethod };
  } catch (error) {
    await q('ROLLBACK').catch(() => {});
    throw error;
  }
}

/**
 * Only delete data belonging to our unique marker. All assertions precede
 * DELETE/UPDATE statements in the same transaction; any anomaly rolls back.
 * Inventory movement trigger applies on INSERT; the synthetic stock row is
 * deleted explicitly after its movements (no attempt to reverse real stock).
 * Recovery with --cleanup-marker can be run after an interrupted HTTP run.
 */
async function cleanupFixture(tag) {
  ASSERT_ENV(/^M11_[A-F0-9]{10}$/.test(tag), 'Marcador de limpieza inválido.');
  console.log(`[M11] Verificando la propiedad de los datos de ${tag} antes de limpiar...`);
  await q('BEGIN');
  try {
    await q("SET LOCAL lock_timeout = '5s'");
    await q("SET LOCAL statement_timeout = '20000ms'");
    const find = async (sql, params) => (await q(sql, params)).rows;
    const cmp = (a, b, description) => assert.deepEqual(a.slice().sort(), b.slice().sort(), description);
    const companies = await find(`SELECT id::text, razon_social, nombre_comercial FROM pos.empresa
      WHERE razon_social=ANY($1::text[]) ORDER BY id FOR UPDATE`, [[`${tag}_A`, `${tag}_B`]]);
    if (companies.length === 0) {
      // No test rows: e.g. cleanup after failed fixture transaction.
      await q('ROLLBACK');
      ok(`No existen empresas de ${tag}; no se eliminó nada.`);
      return;
    }
    assert.equal(companies.length, 2, 'El marcador no corresponde a las dos empresas sintéticas.');
    const byName = Object.fromEntries(companies.map(x => [x.razon_social, x]));
    const ca = byName[`${tag}_A`], cb = byName[`${tag}_B`];
    assert.ok(ca && cb && ca.nombre_comercial === `${tag}_A` && cb.nombre_comercial === `${tag}_B`,
      'Empresas no coinciden exactamente con el marcador.');
    const companiesIds = [ca.id, cb.id];

    const branches = await find(`SELECT s.id::text,s.empresa_id::text,s.codigo FROM pos.sucursal s
      WHERE s.empresa_id=ANY($1::bigint[]) ORDER BY s.id FOR UPDATE`, [companiesIds]);
    assert.equal(branches.length, 2, 'Una empresa contiene sucursales ajenas.');
    const ba = branches.find(x => x.empresa_id === ca.id), bb = branches.find(x => x.empresa_id === cb.id);
    assert.ok(ba && bb && ba.codigo === `S_${tag}_A` && bb.codigo === `S_${tag}_B`,
      'Sucursales ajenas al fixture.');
    const branchIds = branches.map(x => x.id);
    const warehouses = await find(`SELECT a.id::text,a.sucursal_id::text,a.codigo FROM pos.almacen a
      WHERE a.sucursal_id=ANY($1::bigint[]) ORDER BY a.id FOR UPDATE`, [branchIds]);
    assert.equal(warehouses.length, 2, 'Almacenes ajenos al fixture.');
    const wa = warehouses.find(x => x.sucursal_id === ba.id), wb = warehouses.find(x => x.sucursal_id === bb.id);
    assert.ok(wa && wb && wa.codigo === 'ALM_A' && wb.codigo === 'ALM_B', 'Almacén extraño.');
    const warehouseIds = warehouses.map(x => x.id);

    const users = await find(`SELECT id::text, empresa_id::text, username FROM pos.usuario
      WHERE empresa_id=ANY($1::bigint[]) ORDER BY id FOR UPDATE`, [companiesIds]);
    cmp(users.map(x => x.username), [
      `m11_${tag.toLowerCase()}_a`, `m11_${tag.toLowerCase()}_b`, `m11_view_${tag.toLowerCase()}`
    ], 'Usuarios ajenos al fixture.');
    const ua = users.find(x => x.username === `m11_${tag.toLowerCase()}_a`);
    const ub = users.find(x => x.username === `m11_${tag.toLowerCase()}_b`);
    const uv = users.find(x => x.username === `m11_view_${tag.toLowerCase()}`);
    assert.ok(ua?.empresa_id === ca.id && ub?.empresa_id === cb.id && uv?.empresa_id === ca.id);
    const userIds = users.map(x => x.id);

    const roles = await find(`SELECT id::text,codigo FROM pos.rol WHERE codigo=ANY($1::text[]) ORDER BY id FOR UPDATE`,
      [[`R_${tag}`, `RV_${tag}`]]);
    cmp(roles.map(x => x.codigo), [`R_${tag}`, `RV_${tag}`], 'Roles incompletos o ajenos.');
    const roleIds = roles.map(x => x.id);
    const unit = await find(`SELECT id::text,codigo FROM pos.unidad_medida WHERE codigo=$1 FOR UPDATE`, [`UNIT_${tag}`]);
    assert.equal(unit.length, 1, 'Unidad sintética ausente.');
    const methods = await find(`SELECT id::text,codigo,es_efectivo FROM pos.metodo_pago
      WHERE codigo=ANY($1::text[]) ORDER BY id FOR UPDATE`, [[`PAY_${tag}`,`CASH_${tag}`]]);
    cmp(methods.map(x => x.codigo), [`PAY_${tag}`,`CASH_${tag}`], 'Métodos sintéticos ajenos.');
    assert.equal(methods.find(x=>x.codigo===`PAY_${tag}`).es_efectivo, false);
    assert.equal(methods.find(x=>x.codigo===`CASH_${tag}`).es_efectivo, true);
    const methodIds = methods.map(x => x.id);

    const products = await find(`SELECT id::text,sku,codigo_barras,empresa_id::text,unidad_medida_id::text
      FROM pos.producto WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`, [companiesIds]);
    assert.equal(products.length, 1, 'Hay productos ajenos en las empresas de prueba.');
    const prod = products[0];
    assert.ok(prod.empresa_id === ca.id && prod.unidad_medida_id === unit[0].id &&
      prod.sku === `SKU_${tag}` && prod.codigo_barras === `BAR_${tag}`, 'Producto no sintético.');
    const customers = await find(`SELECT id::text,empresa_id::text,codigo FROM pos.cliente
      WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`, [companiesIds]);
    assert.equal(customers.length, 1);
    assert.equal(customers[0].codigo, `CLI_${tag}`);
    assert.equal(customers[0].empresa_id, ca.id);
    const taxes = await find(`SELECT id::text,empresa_id::text,codigo FROM pos.impuesto
      WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`, [companiesIds]);
    assert.equal(taxes.length, 1);
    assert.ok(taxes[0].codigo === `TAX_${tag}` && taxes[0].empresa_id === ca.id);
    assert.equal(await scalar(`SELECT count(*)::int AS n FROM pos.cliente_direccion WHERE cliente_id=$1`,
      [customers[0].id]), 0, 'Dirección de cliente ajena.');
    const pi = await find(`SELECT producto_id::text,impuesto_id::text FROM pos.producto_impuesto
      WHERE producto_id=$1`, [prod.id]);
    assert.deepEqual(pi, [{producto_id:prod.id,impuesto_id:taxes[0].id}]);

    const cashBoxes = await find(`SELECT id::text,sucursal_id::text,codigo FROM pos.caja
      WHERE sucursal_id=ANY($1::bigint[]) FOR UPDATE`, [branchIds]);
    assert.equal(cashBoxes.length, 1);
    assert.ok(cashBoxes[0].sucursal_id === ba.id && cashBoxes[0].codigo === `C_${tag}`);
    const sessions = await find(`SELECT id::text,caja_id::text,usuario_apertura_id::text FROM pos.sesion_caja
      WHERE caja_id=$1 FOR UPDATE`, [cashBoxes[0].id]);
    assert.equal(sessions.length, 1);
    assert.ok(sessions[0].usuario_apertura_id === ua.id && sessions[0].caja_id === cashBoxes[0].id);

    const quotes = await find(`SELECT id::text,folio,empresa_id::text,sucursal_id::text FROM pos.cotizacion
      WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`, [companiesIds]);
    const orders = await find(`SELECT id::text,folio,empresa_id::text,sucursal_id::text,cotizacion_id::text
      FROM pos.orden_venta WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`, [companiesIds]);
    const sales = await find(`SELECT id::text,folio,empresa_id::text,sucursal_id::text,orden_venta_id::text
      FROM pos.venta WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`, [companiesIds]);
    for (const [label, rows] of [['cotizacion',quotes],['orden',orders],['venta',sales]]) {
      assert.ok(rows.every(x=>x.folio.startsWith(`${tag}_`) && x.empresa_id === ca.id && x.sucursal_id === ba.id),
        `${label}: existe un documento ajeno al marcador.`);
    }
    const quoteIds = quotes.map(x=>x.id), orderIds=orders.map(x=>x.id), saleIds=sales.map(x=>x.id);
    assert.ok(orders.every(x => x.cotizacion_id===null || quoteIds.includes(x.cotizacion_id)), 'Orden referencia cotización ajena.');
    assert.ok(sales.every(x => x.orden_venta_id===null || orderIds.includes(x.orden_venta_id)), 'Venta referencia orden ajena.');
    for (const table of ['compra','transferencia_almacen','pedido_cliente','proveedor',
      'categoria','configuracion_empresa','operacion_compra','operacion_transferencia']) {
      assert.equal(await scalar(`SELECT count(*)::int AS n FROM pos.${table} WHERE empresa_id=ANY($1::bigint[])`,[companiesIds]),
        0, `${table}: existen registros ajenos; no limpiar.`);
    }
    const userAssigned = await find(`SELECT usuario_id::text,sucursal_id::text FROM pos.usuario_sucursal
      WHERE usuario_id=ANY($1::bigint[])`,[userIds]);
    assert.equal(userAssigned.length, 3);
    assert.ok(userAssigned.every(x =>
      (x.usuario_id===ua.id && x.sucursal_id===ba.id) ||
      (x.usuario_id===uv.id && x.sucursal_id===ba.id) ||
      (x.usuario_id===ub.id && x.sucursal_id===bb.id)), 'Asignaciones ajenas.');
    const userRoles = await find(`SELECT usuario_id::text,rol_id::text FROM pos.usuario_rol
      WHERE usuario_id=ANY($1::bigint[])`,[userIds]);
    assert.equal(userRoles.length, 3);
    assert.ok(userRoles.every(x=>roleIds.includes(x.rol_id)), 'Usuario asociado con rol ajeno.');
    const rolePerms = await find(`SELECT rol_id::text FROM pos.rol_permiso WHERE rol_id=ANY($1::bigint[])`,[roleIds]);
    assert.equal(rolePerms.length, 6, 'El rol sintético tiene permisos inesperados.');
    assert.ok(rolePerms.every(x=>roleIds.includes(x.rol_id)));

    const audit = await find(`SELECT tabla, registro_id::text FROM pos.auditoria WHERE usuario_id=ANY($1::bigint[])`,[userIds]);
    const ownedAuditIds = {cotizacion:quoteIds,orden_venta:orderIds,venta:saleIds};
    assert.ok(audit.every(x => ownedAuditIds[x.tabla]?.includes(x.registro_id)),
      'Auditoría de operación ajena.');
    const movements = await find(`SELECT x.id::text,x.producto_id::text,x.almacen_id::text,x.usuario_id::text,
      x.documento_tipo,x.documento_id::text,x.estado FROM
      (SELECT m.*, e.estado FROM pos.movimiento_inventario m LEFT JOIN pos.sincronizacion_ecommerce_inventario e
       ON e.movimiento_inventario_id=m.id WHERE m.producto_id=$1) x`,[prod.id]);
    assert.ok(movements.every(x=>x.almacen_id===wa.id && x.usuario_id===ua.id &&
      ((x.documento_tipo==='PRUEBA_M11' && x.documento_id===null) ||
       (x.documento_tipo==='VENTA' && saleIds.includes(x.documento_id)))),
      'Movimiento de inventario ajeno.');
    assert.ok(movements.every(x=>x.estado===null || x.estado==='PENDIENTE'),
      'Outbox procesado por algún worker: no limpiar y revisar Ecommerce.');
    assert.equal(await scalar(`SELECT count(*)::int AS n FROM pos.movimiento_inventario
      WHERE almacen_id=ANY($1::bigint[]) AND producto_id<>$2`, [warehouseIds,prod.id]),0,
      'Hay movimientos de otros productos en almacenes de prueba.');
    const stockRows = await find(`SELECT producto_id::text,almacen_id::text FROM pos.existencia
      WHERE almacen_id=ANY($1::bigint[])`,[warehouseIds]);
    assert.ok(stockRows.every(x=>x.producto_id===prod.id && x.almacen_id===wa.id),
      'Existencias ajenas al producto sintético.');
    const payments = await find(`SELECT venta_id::text,metodo_pago_id::text,sesion_caja_id::text FROM pos.venta_pago
      WHERE venta_id=ANY($1::bigint[])`, [saleIds]);
    assert.ok(payments.every(x=>methodIds.includes(x.metodo_pago_id) &&
      (x.sesion_caja_id===null || x.sesion_caja_id===sessions[0].id)), 'Pago fuera de métodos sintéticos.');
    const cashMovements = await find(`SELECT sesion_caja_id::text,usuario_id::text,referencia FROM pos.movimiento_caja
      WHERE sesion_caja_id=$1`,[sessions[0].id]);
    assert.ok(cashMovements.every(x=>x.usuario_id===ua.id &&
      saleIds.some(sid=>x.referencia?.startsWith(`VENTA:${sid}:PAGO:`))), 'Movimiento de caja ajeno.');
    const outbox = await find(`SELECT e.estado,e.intentos FROM pos.sincronizacion_ecommerce_inventario e
      JOIN pos.movimiento_inventario m ON m.id=e.movimiento_inventario_id WHERE m.producto_id=$1`,[prod.id]);
    assert.ok(outbox.every(x=>x.estado==='PENDIENTE' && x.intentos===0),
      'Outbox enviado/reintentado: suspender limpieza y revisar posible worker externo.');
    assert.equal(await scalar(`SELECT count(*)::int AS n FROM pos.devolucion_venta
      WHERE venta_id=ANY($1::bigint[])`,[saleIds]),0,'Hay devoluciones inesperadas.');
    const saleDetailCount = await scalar(`SELECT count(*)::int AS n FROM pos.venta_detalle
      WHERE venta_id=ANY($1::bigint[]) AND producto_id<>$2`, [saleIds,prod.id]);
    assert.equal(saleDetailCount,0,'Venta tiene detalles ajenos.');
    assert.equal(await scalar(`SELECT count(*)::int AS n FROM pos.orden_venta_detalle
      WHERE orden_venta_id=ANY($1::bigint[]) AND producto_id<>$2`,[orderIds,prod.id]),0,'Orden tiene detalles ajenos.');
    assert.equal(await scalar(`SELECT count(*)::int AS n FROM pos.cotizacion_detalle
      WHERE cotizacion_id=ANY($1::bigint[]) AND producto_id<>$2`,[quoteIds,prod.id]),0,'Cotización tiene detalles ajenos.');

    // All deletes are narrow, scoped to verified synthetic IDs; no broad cleanup.
    await q('DELETE FROM pos.auditoria WHERE usuario_id=ANY($1::bigint[])',[userIds]);
    await q(`DELETE FROM pos.sincronizacion_ecommerce_inventario WHERE movimiento_inventario_id IN
      (SELECT id FROM pos.movimiento_inventario WHERE producto_id=$1)`,[prod.id]);
    await q('DELETE FROM pos.movimiento_caja WHERE sesion_caja_id=$1',[sessions[0].id]);
    await q('DELETE FROM pos.venta_pago WHERE venta_id=ANY($1::bigint[])',[saleIds]);
    await q("UPDATE pos.venta SET estado='BORRADOR' WHERE id=ANY($1::bigint[])",[saleIds]);
    await q('DELETE FROM pos.venta_detalle WHERE venta_id=ANY($1::bigint[])',[saleIds]);
    await q('DELETE FROM pos.venta WHERE id=ANY($1::bigint[])',[saleIds]);
    await q('DELETE FROM pos.movimiento_inventario WHERE producto_id=$1',[prod.id]);
    await q('DELETE FROM pos.existencia WHERE producto_id=$1',[prod.id]);
    await q('DELETE FROM pos.orden_venta_detalle WHERE orden_venta_id=ANY($1::bigint[])',[orderIds]);
    await q('DELETE FROM pos.orden_venta WHERE id=ANY($1::bigint[])',[orderIds]);
    await q("UPDATE pos.cotizacion SET estado='BORRADOR' WHERE id=ANY($1::bigint[])",[quoteIds]);
    await q('DELETE FROM pos.cotizacion_detalle WHERE cotizacion_id=ANY($1::bigint[])',[quoteIds]);
    await q('DELETE FROM pos.cotizacion WHERE id=ANY($1::bigint[])',[quoteIds]);
    await q('DELETE FROM pos.producto_impuesto WHERE producto_id=$1',[prod.id]);
    await q('DELETE FROM pos.impuesto WHERE id=$1',[taxes[0].id]);
    await q('DELETE FROM pos.cliente WHERE id=$1',[customers[0].id]);
    await q('DELETE FROM pos.sesion_caja WHERE id=$1',[sessions[0].id]);
    await q('DELETE FROM pos.caja WHERE id=$1',[cashBoxes[0].id]);
    await q('DELETE FROM pos.producto WHERE id=$1',[prod.id]);
    await q('DELETE FROM pos.almacen WHERE id=ANY($1::bigint[])',[warehouseIds]);
    await q('DELETE FROM pos.usuario_rol WHERE usuario_id=ANY($1::bigint[])',[userIds]);
    await q('DELETE FROM pos.usuario_sucursal WHERE usuario_id=ANY($1::bigint[])',[userIds]);
    await q('DELETE FROM pos.usuario WHERE id=ANY($1::bigint[])',[userIds]);
    await q('DELETE FROM pos.sucursal WHERE id=ANY($1::bigint[])',[branchIds]);
    await q('DELETE FROM pos.empresa WHERE id=ANY($1::bigint[])',[companiesIds]);
    await q('DELETE FROM pos.rol_permiso WHERE rol_id=ANY($1::bigint[])',[roleIds]);
    await q('DELETE FROM pos.rol WHERE id=ANY($1::bigint[])',[roleIds]);
    await q('DELETE FROM pos.unidad_medida WHERE id=$1',[unit[0].id]);
    await q('DELETE FROM pos.metodo_pago WHERE id=ANY($1::bigint[])',[methodIds]);
    const still = await scalar(`SELECT count(*)::int AS n FROM pos.empresa WHERE razon_social=ANY($1::text[])`,
      [[`${tag}_A`,`${tag}_B`]]);
    assert.equal(still,0,'Aún existen empresas sintéticas tras limpieza.');
    await q('COMMIT');
    ok(`Limpieza de ${tag} confirmada en una transacción. No se eliminaron filas ajenas.`);
  } catch (error) {
    await q('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  await db.connect(); state.connected = true;
  await preflight();
  if (preflightOnly) { console.log('[M11] PRE-FLIGHT aprobado; sin modificaciones.'); return; }
  if (recoveryMarker) { await cleanupFixture(marker); state.cleaned = true; return; }

  const { tokenService } = await import('../../src/modules/auth/token.service.js');
  const { app } = await import('../../src/app.ts');
  console.log(`[M11] MARCADOR DE RECUPERACIÓN: ${marker}`);
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
  // Mantener la orden LISTA sin cancelar para comprobar su conversión a venta.

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
  assert.match(String(cashSaleId),/^\d+$/);
  assert.equal(await scalar('SELECT count(*)::int AS n FROM pos.venta_pago WHERE venta_id=$1',[cashSaleId]),1);
  assert.equal(await scalar('SELECT count(*)::int AS n FROM pos.movimiento_caja WHERE sesion_caja_id=$1',[f.a.session]),1);
  assert.equal(await scalar(`SELECT count(*)::int AS n FROM pos.sincronizacion_ecommerce_inventario e JOIN pos.movimiento_inventario m ON m.id=e.movimiento_inventario_id WHERE m.documento_tipo='VENTA' AND m.producto_id=$1`,[f.a.product]),2);
  const finalStock=(await q('SELECT cantidad::text FROM pos.existencia WHERE producto_id=$1 AND almacen_id=$2',
    [f.a.product,f.a.warehouse])).rows[0];
  assert.equal(finalStock?.cantidad,'7.000');
  ok('Caja, segunda venta, salida y outbox correctos; stock 7.000');


  // La política actual permite cancelar LISTA solo si todavía no existe venta asociada.
  // Se prueba con una orden aparte: la orden principal permanece convertible.
  const cancelable = await expect(201,'POST','/api/v1/sales-orders',a,{
    sucursal_id:f.a.branch,folio:folio('CANCEL'),
    detalles:[{producto_id:f.a.product,cantidad:'1'}]
  },'Crear orden de cancelación aislada');
  const cancelId = cancelable?.data?.id;
  assert.match(String(cancelId),/^\d+$/);
  await expect(200,'POST',`/api/v1/sales-orders/${cancelId}/start`,a,{},'Iniciar orden cancelable');
  await expect(200,'POST',`/api/v1/sales-orders/${cancelId}/ready`,a,{},'Preparar orden cancelable');
  const canceled = await expect(200,'POST',`/api/v1/sales-orders/${cancelId}/cancel`,a,{},
    'Cancelar orden LISTA sin venta');
  assert.equal(canceled?.data?.estado,'CANCELADA');
  await expect(409,'POST',`/api/v1/sales-orders/${cancelId}/cancel`,a,{},
    'Rechazar cancelación duplicada');
  await expect(409,'POST',`/api/v1/sales-orders/${cancelId}/convert-to-sale`,a,{
    folio:folio('CANCELSALE'),almacen_id:f.a.warehouse,
    pagos:[{metodo_pago_id:f.method,monto:'116.00'}]
  },'No convertir orden CANCELADA');
  assert.equal(await scalar('SELECT count(*)::int AS n FROM pos.venta WHERE empresa_id=$1',
    [f.a.company]),2,'La cancelación no crea ventas adicionales');
  const afterCancelStock=(await q('SELECT cantidad::text FROM pos.existencia WHERE producto_id=$1 AND almacen_id=$2',
    [f.a.product,f.a.warehouse])).rows[0];
  assert.equal(afterCancelStock?.cantidad,'7.000','La cancelación no modifica el inventario');
  ok('Cancelación de LISTA sin venta: 200; con venta: 409; sin efectos secundarios');
  console.log(`[M11] PRUEBAS APROBADAS: ${tests.length} verificaciones. Iniciando limpieza sintética ${marker}.`);
}

try {
  await main();
} catch (error) {
  console.error('[M11 INTEGRACIÓN FALLIDA]',error);
  console.error(`MARCADOR: ${marker}; solo DB ${EXPECTED_DB}, esquema pos.`);
  process.exitCode=1;
} finally {
  if (state.server) await new Promise(resolve => state.server.close(resolve));
  if (state.connected && state.fixtureCreated && !state.cleaned) {
    try {
      await cleanupFixture(marker);
      state.cleaned = true;
    } catch (error) {
      console.error('[M11 ERROR DE LIMPIEZA; FICHAS SIN BORRAR]', error);
      console.error(`RECUPERACIÓN: node --import tsx tests/sales-orders/m11-http-pos-novnix.integration.mjs --cleanup-marker ${marker}`);
      process.exitCode = 1;
    }
  }
  if (state.connected) await db.end().catch(() => {});
  if (state.cleaned) console.log(`[M11] Limpieza verificada de ${marker} en ${EXPECTED_DB}. No se borraron datos preexistentes.`);
}
