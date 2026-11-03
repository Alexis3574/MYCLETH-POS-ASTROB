import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  orderCreateSchema, orderFromQuoteSchema, orderIdSchema,
  orderListSchema, orderUpdateSchema,
} from '../../src/modules/sales-orders/order.schema.js';
import {
  allowedTransition, decimalText, lineAmounts,
} from '../../src/modules/sales-orders/utils/order-values.js';

const detail = { producto_id: '1', cantidad: '3.000', descuento_porcentaje: '10' };
const base = { sucursal_id: '1', folio: 'OV-01', detalles: [detail] };

test('BIGINT: accepts valid range and rejects zero / overflow', () => {
  assert.equal(orderIdSchema.parse('9223372036854775807'), 9223372036854775807n);
  for (const invalid of ['0', '-1', '9223372036854775808', '01', 'abc']) {
    assert.equal(orderIdSchema.safeParse(invalid).success, false);
  }
});

test('create: strips no arbitrary input and rejects company injection', () => {
  assert.equal(orderCreateSchema.safeParse({ ...base, empresa_id: '12' }).success, false);
  assert.equal(orderCreateSchema.safeParse({ ...base, usuario_id: '12' }).success, false);
  assert.equal(orderCreateSchema.safeParse({ ...base, cotizacion_id: '12' }).success, false);
});

test('create: requires distinct products, a branch, and nonempty lines', () => {
  assert.equal(orderCreateSchema.safeParse(base).success, true);
  assert.equal(orderCreateSchema.safeParse({ ...base, detalles: [] }).success, false);
  assert.equal(orderCreateSchema.safeParse({ ...base, detalles: [detail, detail] }).success, false);
});

test('update: rejects empty payload and unrecognized attributes', () => {
  assert.equal(orderUpdateSchema.safeParse({}).success, false);
  assert.equal(orderUpdateSchema.safeParse({ observaciones: 'Entrega' }).success, true);
  assert.equal(orderUpdateSchema.safeParse({ estado: 'FACTURADA' }).success, false);
});

test('from-quote: only folio, optional date, and notes', () => {
  assert.equal(orderFromQuoteSchema.safeParse({ folio: 'OV-COT-01' }).success, true);
  assert.equal(orderFromQuoteSchema.safeParse({ folio: 'OV-01', detalles: [] }).success, false);
});

test('list: limits page size and validates states', () => {
  assert.deepEqual(orderListSchema.parse({}), { page: 1, pageSize: 20 });
  assert.equal(orderListSchema.safeParse({ pageSize: '101' }).success, false);
  assert.equal(orderListSchema.safeParse({ estado: 'BORRADOR' }).success, false);
});

test('decimal precision: quantity and rates are strict', () => {
  assert.equal(decimalText('1.234', 3, true, 11), '1.234');
  assert.equal(decimalText('1.2345', 3, true, 11), null);
  assert.equal(decimalText('0', 3, true, 11), null);
  assert.equal(decimalText('-1', 3, true, 11), null);
  assert.equal(decimalText('1e6', 3, true, 11), null);
});

test('SQL-equivalent HALF_UP line calculation', () => {
  const result = lineAmounts('3', '125.5000', '10.0000', '16.0000');
  assert.equal(result.subtotal.toFixed(2), '376.50');
  assert.equal(result.descuento.toFixed(2), '37.65');
  assert.equal(result.impuesto.toFixed(2), '54.22');
  assert.equal(result.total.toFixed(2), '393.07');
});

test('state transitions are deny-by-default', () => {
  assert.equal(allowedTransition('PENDIENTE', 'start'), true);
  assert.equal(allowedTransition('PENDIENTE', 'ready'), false);
  assert.equal(allowedTransition('EN_PROCESO', 'ready'), true);
  assert.equal(allowedTransition('LISTA', 'cancel'), true);
  assert.equal(allowedTransition('FACTURADA', 'cancel'), false);
  assert.equal(allowedTransition('CANCELADA', 'start'), false);
});
