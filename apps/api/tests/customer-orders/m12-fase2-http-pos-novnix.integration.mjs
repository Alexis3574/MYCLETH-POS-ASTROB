/**
 * M12V — Pedido de Cliente → Venta / integración HTTP en pos_novnix,
 * schema pos. No other database or schema is created.
 * Synthetic fixtures are owned by unique M12V_<hex> markers, validated and
 * removed transactionally after the test. No Ecommerce worker is started.
 * IMPORTANT: stop all other Ecommerce workers connected to this database.
 * Modes: --preflight (read-only), --run (write+clean), --cleanup-marker M12V_XXXXXXXXXX.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';

const EXPECTED_DB = 'pos_novnix';
const EXPECTED_SCHEMA = 'pos';
const ASSERT_ENV = (ok, message) => { if (!ok) throw new Error(`[M12V SAFETY] ${message}`); };
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
  'Elegir exactamente un modo: --preflight, --run o --cleanup-marker M12V_XXXXXXXXXX.');
if (recoveryMarker !== null) ASSERT_ENV(/^M12V_[A-F0-9]{10}$/.test(recoveryMarker), 'Marcador de limpieza inválido.');

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const marker = recoveryMarker || `M12V_${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
const tests = [];
const ok = message => { tests.push(message); console.log(`[PASS] ${message}`); };
const q = (sql, params = []) => db.query(sql, params);
const scalar = async (sql, params = []) => Number((await q(sql, params)).rows[0].n);
const baseline = async () => (await q(`SELECT
 (SELECT count(*)::int FROM pos.empresa) AS empresas,
 (SELECT count(*)::int FROM pos.pedido_cliente) AS pedidos,
 (SELECT count(*)::int FROM pos.pedido_cliente_detalle) AS partidas,
 (SELECT count(*)::int FROM pos.venta) AS ventas,
 (SELECT count(*)::int FROM pos.venta_detalle) AS venta_detalles,
 (SELECT count(*)::int FROM pos.venta_pago) AS pagos,
 (SELECT count(*)::int FROM pos.movimiento_inventario) AS movimientos,
 (SELECT count(*)::int FROM pos.existencia) AS existencias,
 (SELECT count(*)::int FROM pos.sincronizacion_ecommerce_inventario) AS outbox,
 (SELECT count(*)::int FROM pos.movimiento_caja) AS caja,
 (SELECT count(*)::int FROM pos.auditoria) AS auditorias`)).rows[0];
const id = async (sql, params = []) => String((await q(sql, params)).rows[0].id);
const state = { server: null, fixtureCreated: false, connected: false, cleaned: false, baseline: null };

async function preflight() {
  const where = (await q(`SELECT current_database() AS db, inet_server_port() AS port,
    current_setting('transaction_read_only') AS readonly,
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='pos') AS schema_exists`)).rows[0];
  ASSERT_ENV(where.db === EXPECTED_DB && where.port === 5432 && where.schema_exists,
    'Servidor/base/esquema reales no coinciden con pos_novnix/pos.');
  ASSERT_ENV(where.readonly === 'off' || (preflightOnly && where.readonly === 'on'), 'Modo escritura requiere PostgreSQL de lectura/escritura.');
  const expected = ['empresa','sucursal','usuario','rol','permiso','usuario_rol','usuario_sucursal',
    'producto','impuesto','producto_impuesto','almacen','existencia','movimiento_inventario','pedido_cliente','pedido_cliente_detalle',
    'cotizacion','cotizacion_detalle','orden_venta','orden_venta_detalle','venta','venta_detalle',
    'venta_pago','auditoria','sincronizacion_ecommerce_inventario','caja','sesion_caja',
    'metodo_pago','cliente','movimiento_caja','unidad_medida'];
  const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='pos'`)).rows.map(r => r.table_name);
  const missing = expected.filter(x => !tables.includes(x));
  ASSERT_ENV(missing.length === 0, `Esquema pos incompleto: ${missing.join(', ')}`);
  const triggers = (await q(`SELECT t.tgname FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='pos' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal`,
    [['pedido_cliente','pedido_cliente_detalle']])).rows.map(r => r.tgname);
  ASSERT_ENV(['trg_pedido_cliente_actualizado','trg_pedido_cliente_detalle_importes','trg_pedido_cliente_totales'].every(t=>triggers.includes(t)),
    'Triggers M12 no disponibles.');
  const cols = (await q(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='pos' AND table_name='venta'`)).rows.map(r=>r.column_name);
  ASSERT_ENV(cols.includes('pedido_cliente_id'), 'La tabla venta no contiene pedido_cliente_id.');
  const permissionCodes = ['PEDIDOS.VER','PEDIDOS.CREAR','VENTAS.CREAR'];
  const perms = (await q(`SELECT codigo FROM pos.permiso WHERE codigo=ANY($1::text[])`, [permissionCodes])).rows.map(x => x.codigo);
  ASSERT_ENV(permissionCodes.every(code => perms.includes(code)), 'Faltan permisos RBAC necesarios; no se alteran permisos globales.');
  const counts = (await q(`SELECT (SELECT count(*)::int FROM pos.empresa) AS empresas,
    (SELECT count(*)::int FROM pos.venta) AS ventas,
    (SELECT count(*)::int FROM pos.cotizacion) AS cotizaciones,
    (SELECT count(*)::int FROM pos.orden_venta) AS ordenes`)).rows[0];
  ok(`Destino verificado: ${EXPECTED_DB}, esquema ${EXPECTED_SCHEMA}, triggers, relación de origen y permisos presentes; datos existentes intactos (${JSON.stringify(counts)})`);
}

async function fixture() {
  await q('BEGIN');
  try {
    const permissionCodes = ['PEDIDOS.VER','PEDIDOS.CREAR','VENTAS.CREAR'];
    const allPerms = (await q(`SELECT id::text,codigo FROM pos.permiso WHERE codigo=ANY($1::text[])`,[permissionCodes])).rows;
    assert.equal(allPerms.length, permissionCodes.length);
    const mainRole = await id(`INSERT INTO pos.rol(codigo,nombre) VALUES ($1,'M12V Integración') RETURNING id`, [`R_${marker}`]);
    const viewRole = await id(`INSERT INTO pos.rol(codigo,nombre) VALUES ($1,'M12V sin permiso Ventas') RETURNING id`, [`RV_${marker}`]);
    for (const perm of allPerms) {
      await q('INSERT INTO pos.rol_permiso(rol_id,permiso_id) VALUES ($1,$2)',[mainRole,perm.id]);
      if (['PEDIDOS.VER','PEDIDOS.CREAR'].includes(perm.codigo)) await q('INSERT INTO pos.rol_permiso(rol_id,permiso_id) VALUES ($1,$2)',[viewRole,perm.id]);
    }
    const unit = await id(`INSERT INTO pos.unidad_medida(codigo,nombre,permite_decimales)
      VALUES ($1,'M12V unidad de prueba',false) RETURNING id`,[`UNIT_${marker}`]);
    const method = await id(`INSERT INTO pos.metodo_pago(codigo,nombre,es_efectivo)
      VALUES ($1,'M12V transferencia',false) RETURNING id`,[`PAY_${marker}`]);
    const cashMethod = await id(`INSERT INTO pos.metodo_pago(codigo,nombre,es_efectivo)
      VALUES ($1,'M12V efectivo',true) RETURNING id`,[`CASH_${marker}`]);

    const a = {}; const b = {};
    for (const [suffix,obj] of [['A',a],['B',b]]) {
      obj.company = await id(`INSERT INTO pos.empresa(razon_social,nombre_comercial) VALUES ($1,$1) RETURNING id`,[`${marker}_${suffix}`]);
      obj.branch = await id(`INSERT INTO pos.sucursal(empresa_id,codigo,nombre) VALUES ($1,$2,'Sucursal M12V') RETURNING id`,[obj.company,`S_${marker}_${suffix}`]);
      obj.warehouse = await id(`INSERT INTO pos.almacen(sucursal_id,codigo,nombre) VALUES ($1,$2,'Almacén M12V') RETURNING id`,[obj.branch,`ALM_${suffix}`]);
      obj.user = await id(`INSERT INTO pos.usuario(empresa_id,username,password_hash,nombre) VALUES ($1,$2,'M12V_NO_LOGIN','M12V') RETURNING id`,
        [obj.company,`m12v_${marker.toLowerCase()}_${suffix.toLowerCase()}`]);
      await q('INSERT INTO pos.usuario_rol(usuario_id,rol_id) VALUES ($1,$2)',[obj.user,mainRole]);
      await q('INSERT INTO pos.usuario_sucursal(usuario_id,sucursal_id) VALUES ($1,$2)',[obj.user,obj.branch]);
    }
    a.viewer = await id(`INSERT INTO pos.usuario(empresa_id,username,password_hash,nombre) VALUES ($1,$2,'M12V_NO_LOGIN','Visor M12V') RETURNING id`,
      [a.company,`m12v_view_${marker.toLowerCase()}`]);
    await q('INSERT INTO pos.usuario_rol(usuario_id,rol_id) VALUES ($1,$2)',[a.viewer,viewRole]);
    await q('INSERT INTO pos.usuario_sucursal(usuario_id,sucursal_id) VALUES ($1,$2)',[a.viewer,a.branch]);
    a.customer = await id(`INSERT INTO pos.cliente(empresa_id,codigo,nombre) VALUES ($1,$2,'Cliente M12V') RETURNING id`,[a.company,`CLI_${marker}`]);
    a.product = await id(`INSERT INTO pos.producto(empresa_id,unidad_medida_id,sku,codigo_barras,nombre,precio_venta,costo_referencia,tipo,controla_inventario)
      VALUES ($1,$2,$3,$4,'Producto inventariable M12V',100.00,40.0000,'PRODUCTO',true) RETURNING id`,
      [a.company,unit,`SKU_${marker}`,`BAR_${marker}`]);
    const tax = await id(`INSERT INTO pos.impuesto(empresa_id,codigo,nombre,tasa) VALUES ($1,$2,'IVA M12V',16.0000) RETURNING id`,[a.company,`TAX_${marker}`]);
    await q('INSERT INTO pos.producto_impuesto(producto_id,impuesto_id) VALUES ($1,$2)',[a.product,tax]);
    a.cash = await id(`INSERT INTO pos.caja(sucursal_id,codigo,nombre) VALUES ($1,$2,'Caja M12V') RETURNING id`,[a.branch,`C_${marker}`]);
    a.session = await id(`INSERT INTO pos.sesion_caja(caja_id,usuario_apertura_id,monto_apertura) VALUES ($1,$2,500.00) RETURNING id`,[a.cash,a.user]);
    await q(`INSERT INTO pos.movimiento_inventario(producto_id,almacen_id,usuario_id,tipo,cantidad,costo_unitario,documento_tipo,motivo)
      VALUES ($1,$2,$3,'AJUSTE_POSITIVO',10.000,40.0000,'PRUEBA_M12V','Stock sintético aislado')`,[a.product,a.warehouse,a.user]);
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
  ASSERT_ENV(/^M12V_[A-F0-9]{10}$/.test(tag), 'Marcador de limpieza inválido.');
  console.log(`[M12V] Verificando la propiedad de los datos de ${tag} antes de limpiar...`);
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
      `m12v_${tag.toLowerCase()}_a`, `m12v_${tag.toLowerCase()}_b`, `m12v_view_${tag.toLowerCase()}`
    ], 'Usuarios ajenos al fixture.');
    const ua = users.find(x => x.username === `m12v_${tag.toLowerCase()}_a`);
    const ub = users.find(x => x.username === `m12v_${tag.toLowerCase()}_b`);
    const uv = users.find(x => x.username === `m12v_view_${tag.toLowerCase()}`);
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

    const orders = await find(`SELECT id::text,folio,empresa_id::text,sucursal_id::text,cliente_id::text,estado
      FROM pos.pedido_cliente WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`,[companiesIds]);
    const sales = await find(`SELECT id::text,folio,empresa_id::text,sucursal_id::text,pedido_cliente_id::text,
      orden_venta_id::text,cotizacion_id::text,estado FROM pos.venta
      WHERE empresa_id=ANY($1::bigint[]) FOR UPDATE`,[companiesIds]);
    assert.ok(orders.every(x=>['MAIN','CASHORDER','NOSTOCK'].some(v=>x.folio===`${tag}_${v}`) && x.empresa_id===ca.id &&
      x.sucursal_id===ba.id && x.cliente_id===customers[0].id), 'Pedido ajeno al fixture.');
    const orderIds=orders.map(x=>x.id), saleIds=sales.map(x=>x.id);
    assert.ok(sales.every(x=>['SALE','CASHSALE'].some(v=>x.folio===`${tag}_${v}`) && x.empresa_id===ca.id &&
      x.sucursal_id===ba.id && orderIds.includes(x.pedido_cliente_id) &&
      x.orden_venta_id===null && x.cotizacion_id===null), 'Venta ajena al fixture.');
    assert.ok(sales.every(x=>['COMPLETADA','BORRADOR'].includes(x.estado)), 'Estado de venta inesperado.');
    const orderDetails = await find(`SELECT pedido_cliente_id::text,producto_id::text FROM pos.pedido_cliente_detalle
      WHERE pedido_cliente_id=ANY($1::bigint[])`,[orderIds]);
    assert.ok(orderDetails.every(x=>orderIds.includes(x.pedido_cliente_id) && x.producto_id===prod.id),
      'Partida de pedido ajena al fixture.');
    const saleDetails = await find(`SELECT venta_id::text,producto_id::text FROM pos.venta_detalle
      WHERE venta_id=ANY($1::bigint[])`,[saleIds]);
    assert.ok(saleDetails.every(x=>saleIds.includes(x.venta_id) && x.producto_id===prod.id),
      'Detalle de venta ajeno al fixture.');
    for (const table of ['cotizacion','orden_venta','compra','transferencia_almacen','proveedor',
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
    assert.equal(rolePerms.length, 5, 'El rol sintético tiene permisos inesperados.');
    assert.ok(rolePerms.every(x=>roleIds.includes(x.rol_id)));

    const audit = await find(`SELECT tabla,registro_id::text FROM pos.auditoria
      WHERE usuario_id=ANY($1::bigint[])`,[userIds]);
    assert.ok(audit.every(x=>({pedido_cliente:orderIds,venta:saleIds})[x.tabla]?.includes(x.registro_id)),
      'Auditoría ajena al fixture.');
    const movements = await find(`SELECT m.id::text,m.producto_id::text,m.almacen_id::text,
      m.usuario_id::text,m.documento_tipo,m.documento_id::text FROM pos.movimiento_inventario m
      WHERE m.producto_id=$1`,[prod.id]);
    assert.ok(movements.every(x=>x.almacen_id===wa.id && x.usuario_id===ua.id &&
      ((x.documento_tipo==='PRUEBA_M12V' && x.documento_id===null) ||
       (x.documento_tipo==='VENTA' && saleIds.includes(x.documento_id)))),
      'Movimientos de inventario ajenos al fixture.');
    assert.equal(await scalar(`SELECT count(*)::int AS n FROM pos.movimiento_inventario
      WHERE almacen_id=ANY($1::bigint[]) AND producto_id<>$2`,[warehouseIds,prod.id]),0,
      'Movimiento de otros productos en almacenes de prueba.');
    const stockRows = await find(`SELECT producto_id::text,almacen_id::text FROM pos.existencia
      WHERE almacen_id=ANY($1::bigint[])`,[warehouseIds]);
    assert.ok(stockRows.every(x=>x.producto_id===prod.id && x.almacen_id===wa.id),
      'Existencia ajena al producto sintético.');
    const payments = await find(`SELECT venta_id::text,metodo_pago_id::text,sesion_caja_id::text FROM pos.venta_pago
      WHERE venta_id=ANY($1::bigint[])`,[saleIds]);
    assert.ok(payments.every(x=>methodIds.includes(x.metodo_pago_id) &&
      (x.sesion_caja_id===null || x.sesion_caja_id===sessions[0].id)),
      'Pago ajeno al fixture.');
    const cashMovements = await find(`SELECT sesion_caja_id::text,usuario_id::text,referencia FROM pos.movimiento_caja
      WHERE sesion_caja_id=$1`,[sessions[0].id]);
    assert.ok(cashMovements.every(x=>x.usuario_id===ua.id &&
      saleIds.some(sid=>x.referencia?.startsWith(`VENTA:${sid}:PAGO:`))),
      'Movimiento de caja ajeno al fixture.');
    const outbox = await find(`SELECT e.estado,e.intentos FROM pos.sincronizacion_ecommerce_inventario e
      JOIN pos.movimiento_inventario m ON m.id=e.movimiento_inventario_id
      WHERE m.producto_id=$1`,[prod.id]);
    assert.ok(outbox.every(x=>x.estado==='PENDIENTE' && x.intentos===0),
      'Outbox procesado por worker; limpieza bloqueada.');
    assert.equal(await scalar(`SELECT count(*)::int AS n FROM pos.devolucion_venta
      WHERE venta_id=ANY($1::bigint[])`,[saleIds]),0,'Devolución inesperada; detener limpieza.');
    // Deletes constrained by verified fixture-owned IDs, all in one transaction.
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
    await q('DELETE FROM pos.pedido_cliente_detalle WHERE pedido_cliente_id=ANY($1::bigint[])',[orderIds]);
    await q('DELETE FROM pos.pedido_cliente WHERE id=ANY($1::bigint[])',[orderIds]);
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
  if (preflightOnly) { console.log('[M12V] PRE-FLIGHT aprobado; sin modificaciones.'); return; }
  if (recoveryMarker) { await cleanupFixture(marker); state.cleaned = true; return; }

  const { tokenService } = await import('../../src/modules/auth/token.service.js');
  const { app } = await import('../../src/app.ts');
  console.log(`[M12V] MARCADOR DE RECUPERACIÓN: ${marker}`);
  state.baseline = await baseline();
  console.log('[M12V] Conteos iniciales:', JSON.stringify(state.baseline));
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
  const prefix='/api/v1/customer-orders';
  const folio=name=>`${marker}_${name}`;
  const createPayload=(name,quantity='2',discount='10.0000')=>({
    sucursal_id:f.a.branch,cliente_id:f.a.customer,folio:folio(name),
    detalles:[{producto_id:f.a.product,cantidad:quantity,descuento_porcentaje:discount}],
  });
  const pay=(name,amount='208.80',method=f.method,session=undefined)=>({
    folio:folio(name),almacen_id:f.a.warehouse,
    ...(session?{sesion_caja_id:session}:{}),pagos:[{metodo_pago_id:method,monto:amount}],
  });
  const ready=async orderId=>{
    await expect(200,'POST',`${prefix}/${orderId}/confirm`,a,{},'Confirmar pedido');
    await expect(200,'POST',`${prefix}/${orderId}/prepare`,a,{},'Preparar pedido');
    await expect(200,'POST',`${prefix}/${orderId}/ready`,a,{},'Marcar pedido listo');
  };
  await expect(401,'POST',`${prefix}/1/convert-to-sale`,null,{},'JWT obligatorio');
  const created=await expect(201,'POST',prefix,a,createPayload('MAIN'),'Crear pedido');
  const orderId=created?.data?.id;
  assert.match(String(orderId),/^\d+$/);
  assert.equal(Number(created.data.total),208.80);
  const salePayload=pay('SALE');
  await expect(409,'POST',`${prefix}/${orderId}/convert-to-sale`,a,salePayload,
    'No convertir pedido PENDIENTE');
  await ready(orderId);
  await expect(403,'POST',`${prefix}/${orderId}/convert-to-sale`,view,salePayload,
    'PEDIDOS.CREAR sin VENTAS.CREAR no convierte');
  await expect(404,'POST',`${prefix}/${orderId}/convert-to-sale`,b,salePayload,
    'Bloqueo multiempresa');
  await expect(400,'POST',`${prefix}/${orderId}/convert-to-sale`,a,
    {...salePayload,empresa_id:f.b.company},'Rechaza empresa inyectada');
  await expect(422,'POST',`${prefix}/${orderId}/convert-to-sale`,a,pay('WRONG','208.79'),
    'Rechaza pago incorrecto');
  assert.equal(await scalar('SELECT count(*)::int AS n FROM pos.venta WHERE pedido_cliente_id=$1',[orderId]),0);
  assert.equal(await scalar(`SELECT count(*)::int AS n FROM pos.movimiento_inventario
    WHERE documento_tipo='VENTA' AND producto_id=$1`,[f.a.product]),0);
  ok('Errores de conversión sin venta ni movimientos de inventario');
  // La venta debe respetar el pedido histórico, no el precio actual del catálogo.
  await q('UPDATE pos.producto SET precio_venta=999.00 WHERE id=$1',[f.a.product]);
  const results=await Promise.all(Array.from({length:2},()=>
    request('POST',`${prefix}/${orderId}/convert-to-sale`,a,salePayload)));
  assert.deepEqual(results.map(x=>x.status).sort((x,y)=>x-y),[201,409],
    `Concurrencia: ${JSON.stringify(results).slice(0,800)}`);
  const saleId=results.find(x=>x.status===201)?.data?.data?.id;
  assert.match(String(saleId),/^\d+$/);
  ok('Concurrencia: exactamente una venta HTTP 201 y otra HTTP 409');
  await expect(409,'POST',`${prefix}/${orderId}/convert-to-sale`,a,salePayload,
    'Rechaza reintento de venta');
  await expect(409,'POST',`${prefix}/${orderId}/cancel`,a,{},
    'Impide cancelar pedido con venta');
  const saved=(await q(`SELECT pedido_cliente_id::text,orden_venta_id::text,cotizacion_id::text,
    subtotal::text,descuento::text,impuesto::text,total::text,estado FROM pos.venta WHERE id=$1`,[saleId])).rows[0];
  assert.deepEqual(saved,{pedido_cliente_id:orderId,orden_venta_id:null,cotizacion_id:null,
    subtotal:'200.00',descuento:'20.00',impuesto:'28.80',total:'208.80',estado:'COMPLETADA'});
  const current=(await q(`SELECT estado FROM pos.pedido_cliente WHERE id=$1`,[orderId])).rows[0];
  assert.equal(current?.estado,'LISTO','La conversión no debe inventar ENTREGADO ni FACTURADO');
  const lines=(await q(`SELECT d.cantidad::text,d.precio_unitario::text,d.descuento_porcentaje::text,
     d.tasa_impuesto::text,d.subtotal_linea::text,d.descuento_importe::text,
     d.impuesto_importe::text,d.total_linea::text FROM pos.venta_detalle d WHERE d.venta_id=$1`,[saleId])).rows;
  const source=(await q(`SELECT d.cantidad::text,d.precio_unitario::text,d.descuento_porcentaje::text,
     d.tasa_impuesto::text,d.subtotal_linea::text,d.descuento_importe::text,
     d.impuesto_importe::text,d.total_linea::text FROM pos.pedido_cliente_detalle d
     WHERE d.pedido_cliente_id=$1`,[orderId])).rows;
  assert.deepEqual(lines,source,'Partidas históricas y venta deben coincidir exactamente');
  const counts=(await q(`SELECT
    (SELECT count(*)::int FROM pos.venta WHERE pedido_cliente_id=$1) AS ventas,
    (SELECT count(*)::int FROM pos.venta_pago WHERE venta_id=$2) AS pagos,
    (SELECT count(*)::int FROM pos.movimiento_inventario WHERE documento_tipo='VENTA' AND documento_id=$2) AS salidas,
    (SELECT count(*)::int FROM pos.sincronizacion_ecommerce_inventario e JOIN pos.movimiento_inventario m
      ON m.id=e.movimiento_inventario_id WHERE m.documento_tipo='VENTA' AND m.documento_id=$2) AS outbox`,[orderId,saleId])).rows[0];
  assert.deepEqual(counts,{ventas:1,pagos:1,salidas:1,outbox:1});
  assert.equal((await q(`SELECT cantidad::text FROM pos.existencia WHERE producto_id=$1 AND almacen_id=$2`,
    [f.a.product,f.a.warehouse])).rows[0]?.cantidad,'8.000');
  ok('Persistencia PostgreSQL: venta histórica, partidas, pago, salida, outbox, stock=8');
  // Restaurar precio del producto sintético para los pedidos de prueba posteriores.
  await q('UPDATE pos.producto SET precio_venta=100.00 WHERE id=$1',[f.a.product]);

  const cashOrder=await expect(201,'POST',prefix,a,createPayload('CASHORDER','1','0.0000'),'Crear pedido efectivo');
  const cashOrderId=cashOrder?.data?.id;
  await ready(cashOrderId);
  await expect(422,'POST',`${prefix}/${cashOrderId}/convert-to-sale`,a,
    pay('NOSESSION','116.00',f.cashMethod),'Efectivo sin sesión de caja rechazado');
  const cashResult=await expect(201,'POST',`${prefix}/${cashOrderId}/convert-to-sale`,a,
    pay('CASHSALE','116.00',f.cashMethod,f.a.session),'Venta en efectivo con caja');
  const cashSaleId=cashResult?.data?.id;
  assert.match(String(cashSaleId),/^\d+$/);
  assert.equal(await scalar('SELECT count(*)::int AS n FROM pos.movimiento_caja WHERE sesion_caja_id=$1',[f.a.session]),1);
  assert.equal(await scalar('SELECT count(*)::int AS n FROM pos.venta_pago WHERE venta_id=$1',[cashSaleId]),1);
  assert.equal((await q(`SELECT cantidad::text FROM pos.existencia WHERE producto_id=$1 AND almacen_id=$2`,
    [f.a.product,f.a.warehouse])).rows[0]?.cantidad,'7.000');
  ok('Venta en efectivo: caja, pago, inventario y stock=7');

  const noStock=await expect(201,'POST',prefix,a,createPayload('NOSTOCK','8','0.0000'),'Crear pedido sin stock disponible');
  const noStockId=noStock?.data?.id;
  await ready(noStockId);
  await expect(422,'POST',`${prefix}/${noStockId}/convert-to-sale`,a,
    pay('STOCKFAIL','928.00'),'Inventario insuficiente rechazado');
  assert.equal(await scalar('SELECT count(*)::int AS n FROM pos.venta WHERE pedido_cliente_id=$1',[noStockId]),0);
  assert.equal(await scalar(`SELECT count(*)::int AS n FROM pos.movimiento_inventario
    WHERE documento_tipo='VENTA' AND producto_id=$1`,[f.a.product]),2);
  assert.equal(await scalar(`SELECT count(*)::int AS n FROM pos.sincronizacion_ecommerce_inventario e
    JOIN pos.movimiento_inventario m ON m.id=e.movimiento_inventario_id
    WHERE m.documento_tipo='VENTA' AND m.producto_id=$1`,[f.a.product]),2);
  ok('Fallo de stock: ROLLBACK, exactamente dos salidas y dos eventos propios');
  console.log(`[M12V] PRUEBAS APROBADAS: ${tests.length} verificaciones. Iniciando limpieza sintética ${marker}.`);
}

try {
  await main();
} catch (error) {
  console.error('[M12V INTEGRACIÓN FALLIDA]',error);
  console.error(`MARCADOR: ${marker}; solo DB ${EXPECTED_DB}, esquema pos.`);
  process.exitCode=1;
} finally {
  if (state.server) await new Promise(resolve => state.server.close(resolve));
  if (state.connected && state.fixtureCreated && !state.cleaned) {
    try {
      await cleanupFixture(marker);
      state.cleaned = true;
    } catch (error) {
      console.error('[M12V ERROR DE LIMPIEZA; FICHAS SIN BORRAR]', error);
      console.error(`RECUPERACIÓN: node --import tsx tests/customer-orders/m12-fase2-http-pos-novnix.integration.mjs --cleanup-marker ${marker}`);
      process.exitCode = 1;
    }
  }
  if (state.connected && state.cleaned && state.baseline) {
    try {
      const after = await baseline();
      assert.deepEqual(after,state.baseline, 'Los conteos globales no regresaron a sus valores previos.');
      ok('Conteos globales restaurados exactamente.');
    } catch (error) { console.error('[M12V] DIFERENCIA EN CONTEOS',error); process.exitCode=1; }
  }
  if (state.connected) await db.end().catch(() => {});
  if (state.cleaned) console.log(`[M12V] Limpieza verificada de ${marker} en ${EXPECTED_DB}. No se borraron datos preexistentes.`);
}
