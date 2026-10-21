import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { purchaseCreateSchema, purchasePaymentSchema, purchaseKeySchema } from '../../src/modules/purchases/purchase.schema.js';
import { hashPurchaseRequest, normalizePositiveDecimal, purchaseOperationId, parsePositiveId } from '../../src/modules/purchases/utils/purchase-values.js';

test('decimales exactos y límites de magnitud', () => {
  assert.equal(normalizePositiveDecimal('12.5', 4), '12.5000');
  assert.equal(normalizePositiveDecimal('0.01', 2, true), '0.01');
  assert.equal(normalizePositiveDecimal('0', 2, true), null);
  assert.equal(normalizePositiveDecimal('1.00001', 4), null);
  assert.equal(normalizePositiveDecimal('-1', 2), null);
  assert.equal(normalizePositiveDecimal('100000000000.000', 3), null);
});

test('parseo de IDs sin pérdida de precisión', () => {
  assert.equal(parsePositiveId('9223372036854775807'), 9223372036854775807n);
  assert.equal(parsePositiveId('9223372036854775808'), null);
  assert.equal(parsePositiveId('0'), null);
  assert.equal(parsePositiveId('1.1'), null);
});

test('hash reproducible y discriminado por usuario/acción', () => {
  const a = hashPurchaseRequest(5n, 'CREAR', null, { folio: 'F-001' });
  assert.equal(a, hashPurchaseRequest(5n, 'CREAR', null, { folio: 'F-001' }));
  assert.notEqual(a, hashPurchaseRequest(6n, 'CREAR', null, { folio: 'F-001' }));
  assert.notEqual(a, hashPurchaseRequest(5n, 'PAGAR', null, { folio: 'F-001' }));
});

test('IDs de Ecommerce distintos para entrada y reversión', () => {
  assert.notEqual(purchaseOperationId(1n, 2n, 3n, 'stock-in'), purchaseOperationId(1n, 2n, 3n, 'stock-out'));
});

test('validación de compras y pagos', () => {
  const body = { sucursal_id: '1', almacen_id: '2', proveedor_id: '3', folio: 'CMP-001',
    detalles: [{ producto_id: '4', cantidad: '2', precio_unitario: '15.0000', tasa_impuesto: '16' }] };
  assert.equal(purchaseCreateSchema.parse(body).detalles[0]?.tasa_impuesto, '16.0000');
  assert.equal(purchaseCreateSchema.safeParse({ ...body, detalles: [] }).success, false);
  assert.equal(purchaseCreateSchema.safeParse({ ...body, detalles: [{ ...body.detalles[0], cantidad: '-1' }] }).success, false);
  assert.equal(purchasePaymentSchema.parse({ metodo_pago_id: '2', monto: '10.55' }).monto, '10.55');
  assert.equal(purchasePaymentSchema.safeParse({ metodo_pago_id: '2', monto: '10.555' }).success, false);
  assert.equal(purchaseKeySchema.parse(randomUUID()).length, 36);
  assert.equal(purchaseKeySchema.safeParse('foo').success, false);
});
