import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '../../src/generated/prisma/client.js';
import { customerOrderConvertToSaleSchema } from '../../src/modules/customer-orders/customer-order-conversion.schema.js';
import { customerOrderIsConvertible, verifyCustomerOrderMoney } from '../../src/modules/customer-orders/utils/customer-order-sale-values.js';

const valid = { folio: 'VTA-001', almacen_id: '1', pagos: [{ metodo_pago_id: '2', monto: '116.00' }] };
const D = Prisma.Decimal;

test('conversión acepta folio, almacén y pagos de precisión exacta', () => {
  const result = customerOrderConvertToSaleSchema.parse(valid);
  assert.equal(result.almacen_id, 1n);
  assert.equal(result.pagos[0]?.monto, '116.00');
  assert.equal(customerOrderConvertToSaleSchema.safeParse({ ...valid, sesion_caja_id: null }).success, true);
});

test('no acepta alterar empresa, pedido, líneas, precio o impuestos', () => {
  for (const key of ['empresa_id', 'usuario_id', 'pedido_cliente_id', 'estado', 'detalles', 'precio_unitario', 'total']) {
    assert.equal(customerOrderConvertToSaleSchema.safeParse({ ...valid, [key]: '1' }).success, false, key);
  }
});

test('rechaza montos y IDs ambiguos o fuera de escala', () => {
  for (const amount of ['0', '-1', '2.000', 'NaN', '1e4', '9999999999999.99']) {
    assert.equal(customerOrderConvertToSaleSchema.safeParse({ ...valid,
      pagos: [{ metodo_pago_id: '2', monto: amount }] }).success, false, amount);
  }
  assert.equal(customerOrderConvertToSaleSchema.safeParse({ ...valid, almacen_id: '9223372036854775808' }).success, false);
  assert.equal(customerOrderConvertToSaleSchema.safeParse({ ...valid, pagos: [] }).success, false);
});

test('solo admite LISTO y sin ninguna venta anterior', () => {
  assert.equal(customerOrderIsConvertible('LISTO', 0), true);
  for (const state of ['PENDIENTE', 'CONFIRMADO', 'EN_PREPARACION', 'ENTREGADO', 'FACTURADO', 'CANCELADO']) {
    assert.equal(customerOrderIsConvertible(state, 0), false);
  }
  assert.equal(customerOrderIsConvertible('LISTO', 1), false);
});

test('comprueba cabecera y partidas con importes históricos', () => {
  const row = {
    cantidad: new D('2.000'), precio_unitario: new D('100.0000'),
    descuento_porcentaje: new D('10.0000'), tasa_impuesto: new D('16.0000'),
    subtotal_linea: new D('200.00'), descuento_importe: new D('20.00'),
    impuesto_importe: new D('28.80'), total_linea: new D('208.80'),
  };
  const head = { subtotal: new D('200'), descuento: new D('20'),
    impuesto: new D('28.80'), total: new D('208.80') };
  assert.equal(verifyCustomerOrderMoney([row], head), true);
  assert.equal(verifyCustomerOrderMoney([{ ...row, total_linea: new D('208.81') }], head), false);
  assert.equal(verifyCustomerOrderMoney([row], { ...head, total: new D('208.81') }), false);
  assert.equal(verifyCustomerOrderMoney([], head), false);
});
