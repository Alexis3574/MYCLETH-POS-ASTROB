import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '../../src/generated/prisma/client.js';
import { orderConvertToSaleSchema } from '../../src/modules/sales-orders/order-conversion.schema.js';
import { checkOrderLineIntegrity, sumMoney } from '../../src/modules/sales-orders/utils/order-sale-values.js';

const D = Prisma.Decimal;
const valid = {
  folio: 'VEN-ORD-001', almacen_id: '1',
  pagos: [{ metodo_pago_id: '1', monto: '393.07' }],
};

test('conversion schema rejects client-controlled company/price/details', () => {
  assert.equal(orderConvertToSaleSchema.safeParse({ ...valid, empresa_id: '1' }).success, false);
  assert.equal(orderConvertToSaleSchema.safeParse({ ...valid, detalles: [] }).success, false);
  assert.equal(orderConvertToSaleSchema.safeParse({ ...valid, precio_unitario: '1.00' }).success, false);
  assert.equal(orderConvertToSaleSchema.safeParse({ ...valid, usuario_id: '1' }).success, false);
});

test('conversion accepts only exact positive payment amounts', () => {
  assert.equal(orderConvertToSaleSchema.safeParse(valid).success, true);
  for (const monto of ['0', '-1', '1.001', '9999999999999.99', 'NaN']) {
    assert.equal(orderConvertToSaleSchema.safeParse({ ...valid, pagos: [{ metodo_pago_id: '1', monto }] }).success, false);
  }
});

test('historical row calculation matches SQL half-up', () => {
  const row = {
    cantidad: new D('3.000'), precio_unitario: new D('125.5000'),
    descuento_porcentaje: new D('10.0000'), tasa_impuesto: new D('16.0000'),
    subtotal_linea: new D('376.50'), descuento_importe: new D('37.65'),
    impuesto_importe: new D('54.22'), total_linea: new D('393.07'),
  };
  assert.equal(checkOrderLineIntegrity(row), true);
  assert.equal(checkOrderLineIntegrity({ ...row, impuesto_importe: new D('54.21') }), false);
  const totals = sumMoney([row, row]);
  assert.equal(totals.total.toFixed(2), '786.14');
});
