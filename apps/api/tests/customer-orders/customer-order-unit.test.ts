import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  customerOrderIdSchema, customerOrderCreateSchema, customerOrderUpdateSchema,
  customerOrderListSchema, customerOrderActionSchema,
} from '../../src/modules/customer-orders/customer-order.schema.js';
import {
  allowedTransition, decimalText, lineAmounts, destinationState, encodeResponse,
} from '../../src/modules/customer-orders/utils/customer-order-values.js';

const detail = { producto_id: '1', cantidad: '2.000', descuento_porcentaje: '10' };
const base = { sucursal_id: '1', cliente_id: '2', folio: 'PED-01', detalles: [detail] };

test('BIGINT exacto; rechaza overflow, cero y valores ambiguos', () => {
  assert.equal(customerOrderIdSchema.parse('9223372036854775807'), 9223372036854775807n);
  for (const value of ['0', '-1', '01', '9223372036854775808', '5e3', '1.0', 'abc']) {
    assert.equal(customerOrderIdSchema.safeParse(value).success, false);
  }
});
test('crear exige cliente, sucursal y partidas', () => {
  assert.equal(customerOrderCreateSchema.safeParse(base).success, true);
  assert.equal(customerOrderCreateSchema.safeParse({ ...base, cliente_id: undefined }).success, false);
  assert.equal(customerOrderCreateSchema.safeParse({ ...base, detalles: [] }).success, false);
});
test('crear rechaza campos de JWT, estado, precio y totales inyectados', () => {
  for (const field of ['empresa_id', 'usuario_id', 'estado', 'total', 'pedido_cliente_id']) {
    assert.equal(customerOrderCreateSchema.safeParse({ ...base, [field]: '1' }).success, false);
  }
  assert.equal(customerOrderCreateSchema.safeParse({ ...base,
    detalles: [{ ...detail, precio_unitario: '0.0100' }] }).success, false);
});
test('rechaza producto repetido, importe fuera de escala y porcentaje excedido', () => {
  assert.equal(customerOrderCreateSchema.safeParse({ ...base, detalles: [detail, detail] }).success, false);
  assert.equal(customerOrderCreateSchema.safeParse({ ...base, detalles: [{ ...detail, cantidad: '1.1234' }] }).success, false);
  assert.equal(customerOrderCreateSchema.safeParse({ ...base, detalles: [{ ...detail, descuento_porcentaje: '100.0001' }] }).success, false);
});
test('actualización estricta; no permite cambiar estado ni folio', () => {
  assert.equal(customerOrderUpdateSchema.safeParse({}).success, false);
  assert.equal(customerOrderUpdateSchema.safeParse({ observaciones: 'Entregar' }).success, true);
  assert.equal(customerOrderUpdateSchema.safeParse({ estado: 'FACTURADO' }).success, false);
  assert.equal(customerOrderUpdateSchema.safeParse({ folio: 'OTRO' }).success, false);
  assert.equal(customerOrderUpdateSchema.safeParse({ cliente_id: null }).success, false);
});
test('paginación limitada y estados explícitos', () => {
  assert.deepEqual(customerOrderListSchema.parse({}), { page: 1, pageSize: 20 });
  assert.equal(customerOrderListSchema.safeParse({ estado: 'FACTURADO' }).success, true);
  assert.equal(customerOrderListSchema.safeParse({ estado: 'BORRADOR' }).success, false);
  assert.equal(customerOrderListSchema.safeParse({ pageSize: '101' }).success, false);
});
test('acciones no aceptan cuerpo externo', () => {
  assert.equal(customerOrderActionSchema.safeParse({}).success, true);
  assert.equal(customerOrderActionSchema.safeParse({ estado: 'FACTURADO' }).success, false);
});
test('decimales y cálculo HALF_UP congruente con PostgreSQL', () => {
  assert.equal(decimalText('1.234', 3, true, 11), '1.234');
  assert.equal(decimalText('1.2345', 3, true, 11), null);
  const amounts = lineAmounts('3', '125.5000', '10.0000', '16.0000');
  assert.equal(amounts.subtotal.toFixed(2), '376.50');
  assert.equal(amounts.descuento.toFixed(2), '37.65');
  assert.equal(amounts.impuesto.toFixed(2), '54.22');
  assert.equal(amounts.total.toFixed(2), '393.07');
});
test('transiciones permitidas y terminales deny-by-default', () => {
  assert.equal(allowedTransition('PENDIENTE', 'confirm'), true);
  assert.equal(allowedTransition('CONFIRMADO', 'prepare'), true);
  assert.equal(allowedTransition('EN_PREPARACION', 'ready'), true);
  assert.equal(allowedTransition('LISTO', 'deliver'), true);
  assert.equal(allowedTransition('LISTO', 'cancel'), true);
  assert.equal(allowedTransition('ENTREGADO', 'cancel'), false);
  assert.equal(allowedTransition('FACTURADO', 'deliver'), false);
  assert.equal(allowedTransition('CANCELADO', 'confirm'), false);
  assert.equal(allowedTransition('PENDIENTE', 'deliver'), false);
  assert.equal(destinationState.prepare, 'EN_PREPARACION');
});
test('BigInt y Prisma.Decimal se serializan sin pérdida', () => {
  const decoded = encodeResponse({ id: 9223372036854775807n, nested: [1n] });
  assert.deepEqual(decoded, { id: '9223372036854775807', nested: ['1'] });
});
