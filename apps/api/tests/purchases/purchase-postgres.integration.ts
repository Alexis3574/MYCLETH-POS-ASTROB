/** Pruebas con datos sintéticos. NO ejecutar con el worker Ecommerce activo. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const urlText = process.env.PURCHASES_TEST_DATABASE_URL;
if (!urlText || process.env.PURCHASES_ALLOW_DB_TESTS !== 'true' || process.env.POS_ALLOW_TEST_DB !== 'SI') {
  throw new Error('Requiere PURCHASES_TEST_DATABASE_URL, PURCHASES_ALLOW_DB_TESTS=true y POS_ALLOW_TEST_DB=SI.');
}
const url = new URL(urlText);
if (url.pathname !== '/pos_novnix' || !['localhost','127.0.0.1'].includes(url.hostname) ||
  (url.port && url.port !== '5432') || !['postgres:', 'postgresql:'].includes(url.protocol)) {
  throw new Error('Base de datos de pruebas no autorizada.');
}
if (process.env.INVENTORY_SYNC_ENABLED !== 'false') throw new Error('Deshabilite INVENTORY_SYNC_ENABLED=false para estas pruebas.');
process.env.DATABASE_URL = urlText;

const { prisma } = await import('../../src/lib/prisma.js');
const { purchaseService } = await import('../../src/modules/purchases/services/purchase.service.js');
const { purchaseCreateSchema, purchasePaymentSchema } = await import('../../src/modules/purchases/purchase.schema.js');
const { PurchaseError } = await import('../../src/modules/purchases/errors/purchase.errors.js');

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
type Fixture = {
  companyId: bigint; branchId: bigint; warehouseId: bigint; supplierId: bigint;
  userId: bigint; unitId: bigint; productId: bigint; methodId: bigint;
  foreignCompanyId: bigint; cashId: bigint; sessionId: bigint; cashMethodId: bigint;
};
let fixture: Fixture | undefined;

async function createFixture(): Promise<Fixture> {
  return prisma.$transaction(async (tx) => {
    const company = await tx.empresa.create({ data: { razon_social: `PURCHASE_TEST_${suffix}`, nombre_comercial: `PURCHASE_TEST_${suffix}` } });
    const branch = await tx.sucursal.create({ data: { empresa_id: company.id, codigo: 'PRUEBAS', nombre: 'Sucursal sintética' } });
    const warehouse = await tx.almacen.create({ data: { sucursal_id: branch.id, codigo: 'ALM', nombre: 'Almacén sintético' } });
    const supplier = await tx.proveedor.create({ data: { empresa_id: company.id, codigo: `PV-${suffix}`, razon_social: 'Proveedor sintético' } });
    const user = await tx.usuario.create({ data: { empresa_id: company.id, username: `pt-${suffix}`, nombre: 'Prueba', password_hash: 'TEST_NO_LOGIN' } });
    await tx.usuario_sucursal.create({ data: { usuario_id: user.id, sucursal_id: branch.id } });
    const unit = await tx.unidad_medida.create({ data: { codigo: `PT${suffix}`, nombre: 'Unidad sintética' } });
    const product = await tx.producto.create({ data: { empresa_id: company.id, unidad_medida_id: unit.id,
      sku: `P-${suffix}`, codigo_barras: `P-BAR-${suffix}`, nombre: 'Producto sintético', controla_inventario: true } });
    const method = await tx.metodo_pago.create({ data: { codigo: `PT${suffix}`, nombre: 'Método sintético', es_efectivo: false } });
    const cash = await tx.caja.create({ data: { sucursal_id: branch.id, codigo: 'CAJA', nombre: 'Caja sintética' } });
    const session = await tx.sesion_caja.create({ data: { caja_id: cash.id, usuario_apertura_id: user.id, monto_apertura: '500.00' } });
    const cashMethod = await tx.metodo_pago.create({ data: { codigo: `PTC${suffix}`, nombre: 'Efectivo sintético', es_efectivo: true } });
    const foreign = await tx.empresa.create({ data: { razon_social: `FOREIGN_TEST_${suffix}`, nombre_comercial: `FOREIGN_TEST_${suffix}` } });
    return { companyId: company.id, branchId: branch.id, warehouseId: warehouse.id, supplierId: supplier.id,
      userId: user.id, unitId: unit.id, productId: product.id, methodId: method.id, cashMethodId: cashMethod.id, cashId: cash.id, sessionId: session.id, foreignCompanyId: foreign.id };
  });
}

async function cleanup(f: Fixture) {
  await prisma.$transaction(async (tx) => {
    await tx.auditoria.deleteMany({ where: { usuario_id: f.userId } });
    await tx.sincronizacion_ecommerce_inventario.deleteMany({ where: { movimiento_inventario: { producto_id: f.productId } } });
    await tx.$executeRaw`DELETE FROM pos.operacion_compra WHERE empresa_id = ${f.companyId}`;
    await tx.compra_pago.deleteMany({ where: { compra: { empresa_id: f.companyId } } });
    await tx.movimiento_caja.deleteMany({ where: { usuario_id: f.userId } });
    await tx.movimiento_inventario.deleteMany({ where: { producto_id: f.productId } });
    const syntheticCompany = await tx.empresa.findUnique({
      where: { id: f.companyId },
      select: { razon_social: true, nombre_comercial: true }
    });
    if (syntheticCompany?.razon_social !== `PURCHASE_TEST_${suffix}` ||
        syntheticCompany.nombre_comercial !== `PURCHASE_TEST_${suffix}`) {
      throw new Error("Limpieza detenida: empresa no sintetica.");
    }
    await tx.compra.updateMany({
      where: { empresa_id: f.companyId, estado: { in: ["RECIBIDA", "CANCELADA"] } },
      data: { estado: "BORRADOR" }
    });
    await tx.compra_detalle.deleteMany({ where: { compra: { empresa_id: f.companyId } } });
    await tx.compra.deleteMany({ where: { empresa_id: f.companyId } });
    await tx.existencia.deleteMany({ where: { producto_id: f.productId } });
    await tx.sesion_caja.deleteMany({ where: { id: f.sessionId } });
    await tx.caja.deleteMany({ where: { id: f.cashId } });
    await tx.producto.deleteMany({ where: { id: f.productId } });
    await tx.proveedor.deleteMany({ where: { id: f.supplierId } });
    await tx.almacen.deleteMany({ where: { id: f.warehouseId } });
    await tx.usuario_sucursal.deleteMany({ where: { usuario_id: f.userId } });
    await tx.usuario.deleteMany({ where: { id: f.userId } });
    await tx.sucursal.deleteMany({ where: { id: f.branchId } });
    await tx.empresa.deleteMany({ where: { id: f.companyId } });
    await tx.empresa.deleteMany({ where: { id: f.foreignCompanyId } });
    await tx.unidad_medida.deleteMany({ where: { id: f.unitId } });
    await tx.metodo_pago.deleteMany({ where: { id: f.methodId } });
    await tx.metodo_pago.deleteMany({ where: { id: f.cashMethodId } });
  });
}

try {
  fixture = await createFixture();
  const f = fixture;
  const actor = { empresaId: f.companyId, userId: f.userId };
  const createInput = (folio: string) => purchaseCreateSchema.parse({
    sucursal_id: f.branchId.toString(), almacen_id: f.warehouseId.toString(),
    proveedor_id: f.supplierId.toString(), folio,
    detalles: [{ producto_id: f.productId.toString(), cantidad: '2', precio_unitario: '12.5000', tasa_impuesto: '16' }],
  });
  const createKey = randomUUID();
  const first = await purchaseService.create(actor, createInput(`P-A-${suffix}`), createKey);
  const replay = await purchaseService.create(actor, createInput(`P-A-${suffix}`), createKey);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  const id = BigInt((first.data as { id: string }).id);
  assert.equal((first.data as { total: string }).total, '29');
  assert.equal(await prisma.compra.count({ where: { empresa_id: actor.empresaId } }), 1);
  await assert.rejects(() => purchaseService.create(actor, createInput(`P-B-${suffix}`), createKey), (e: unknown) => e instanceof PurchaseError && e.code === 'PURCHASE_IDEMPOTENCY_CONFLICT');

  const receiveKey = randomUUID();
  const received = await Promise.all(Array.from({ length: 4 }, () => purchaseService.receive(actor, id, receiveKey)));
  assert.equal(received.filter((r) => !r.replayed).length, 1);
  assert.equal(await prisma.movimiento_inventario.count({ where: { documento_tipo: 'COMPRA', documento_id: id } }), 1);
  assert.equal(await prisma.sincronizacion_ecommerce_inventario.count({ where: { movimiento_inventario: { documento_tipo: 'COMPRA', documento_id: id } } }), 1);
  const stock = await prisma.existencia.findUnique({ where: { producto_id_almacen_id: { producto_id: f.productId, almacen_id: f.warehouseId } } });
  assert.equal(stock?.cantidad.toFixed(3), '2.000');
  assert.equal(stock?.costo_promedio.toFixed(4), '12.5000');
  await assert.rejects(() => purchaseService.receive(actor, id, randomUUID()),
    (error: unknown) => error instanceof PurchaseError && error.code === 'PURCHASE_INVALID_STATE');

  const paymentInput = purchasePaymentSchema.parse({ metodo_pago_id: f.methodId.toString(), monto: '10.00', referencia: `REF-${suffix}` });
  const paymentKey = randomUUID();
  const payment = await purchaseService.pay(actor, id, paymentKey, paymentInput);
  const samePayment = await purchaseService.pay(actor, id, paymentKey, paymentInput);
  assert.equal(payment.replayed, false);
  assert.equal(samePayment.replayed, true);
  assert.equal(await prisma.compra_pago.count({ where: { compra_id: id } }), 1);
  await assert.rejects(() => purchaseService.pay(actor, id, randomUUID(), purchasePaymentSchema.parse({ metodo_pago_id: f.methodId.toString(), monto: '25' })),
    (error: unknown) => error instanceof PurchaseError && error.code === 'PURCHASE_OVERPAYMENT');
  await assert.rejects(() => purchaseService.cancel(actor, id, randomUUID(), 'Cancelar pagada'),
    (error: unknown) => error instanceof PurchaseError && error.code === 'PURCHASE_HAS_PAYMENTS');

  const cashPayment = purchasePaymentSchema.parse({ metodo_pago_id: f.cashMethodId.toString(), monto: '5.00', sesion_caja_id: f.sessionId.toString() });
  const cashResult = await purchaseService.pay(actor, id, randomUUID(), cashPayment);
  assert.equal(cashResult.replayed, false);
  assert.equal(await prisma.movimiento_caja.count({ where: { sesion_caja_id: f.sessionId, referencia: { startsWith: `COMPRA:${id}:PAGO:` } } }), 1);

  const second = await purchaseService.create(actor, createInput(`P-C-${suffix}`), randomUUID());
  const secondId = BigInt((second.data as { id: string }).id);
  await purchaseService.receive(actor, secondId, randomUUID());
  const cancelKey = randomUUID();
  const cancelled = await purchaseService.cancel(actor, secondId, cancelKey, 'Cancelación sintética');
  const repeatedCancel = await purchaseService.cancel(actor, secondId, cancelKey, 'Cancelación sintética');
  assert.equal(cancelled.replayed, false);
  assert.equal(repeatedCancel.replayed, true);
  assert.equal(await prisma.movimiento_inventario.count({ where: { documento_tipo: 'CANCELACION_COMPRA', documento_id: secondId } }), 1);
  assert.equal(await prisma.sincronizacion_ecommerce_inventario.count({ where: { movimiento_inventario: { documento_tipo: 'CANCELACION_COMPRA', documento_id: secondId } } }), 1);
  const allStock = await prisma.existencia.findUnique({ where: { producto_id_almacen_id: { producto_id: f.productId, almacen_id: f.warehouseId } } });
  assert.equal(allStock?.cantidad.toFixed(3), '2.000');

  await assert.rejects(() => purchaseService.get({ empresaId: f.foreignCompanyId, userId: f.userId }, id),
    (error: unknown) => error instanceof PurchaseError && error.code === 'PURCHASE_ACTOR_INVALID');
  const forbidden = purchaseCreateSchema.parse({ sucursal_id: f.branchId.toString(), almacen_id: f.warehouseId.toString(), proveedor_id: f.productId.toString(), folio: 'OTHER', detalles: [{ producto_id: f.productId.toString(), cantidad: '1', precio_unitario: '1' }] });
  await assert.rejects(() => purchaseService.create(actor, forbidden, randomUUID()),
    (error: unknown) => error instanceof PurchaseError && error.code === 'PURCHASE_INVALID_CONTEXT');
  console.log('[OK] Crear, replay, concurrencia, recepción, inventario, outbox, pagos, cancelación y aislamiento.');
} catch (error) {
  console.error('[purchases-integration]', error);
  process.exitCode = 1;
} finally {
  if (fixture) {
    try { await cleanup(fixture); console.log('[OK] Limpieza sintética completada.'); }
    catch (error) { process.exitCode = 1; console.error('[ERROR LIMPIEZA]', error); }
  }
  await prisma.$disconnect();
}
