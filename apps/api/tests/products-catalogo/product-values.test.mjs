import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDecimal, stockBoundsValid, validId } from '../../src/modules/products/utils/product-values.ts';

test('preserva precisión y límites de NUMERIC(14,2)', () => {
  assert.equal(normalizeDecimal('999999999999.99', 2), '999999999999.99');
  assert.equal(normalizeDecimal('1000000000000.00', 2), null);
  assert.equal(normalizeDecimal('0012.5', 2), '12.50');
  assert.equal(normalizeDecimal('0', 2), '0.00');
});
test('rechaza negativos, redondeos implícitos y notación exponencial', () => {
  for (const value of ['-1', '1.001', '1e3', 'NaN', 'Infinity', '', '0x10', '12,50']) {
    assert.equal(normalizeDecimal(value, 2), null, value);
  }
});
test('valida las escalas de costo y stock', () => {
  assert.equal(normalizeDecimal('9999999999.9999', 4), '9999999999.9999');
  assert.equal(normalizeDecimal('99999999999.999', 3), '99999999999.999');
  assert.equal(normalizeDecimal('1.00001', 4), null);
  assert.equal(normalizeDecimal('1.0001', 3), null);
});
test('compara stock sin perder milésimas', () => {
  assert.equal(stockBoundsValid('99999999999.998', '99999999999.999'), true);
  assert.equal(stockBoundsValid('99999999999.999', '99999999999.998'), false);
  assert.equal(stockBoundsValid('1.000', '1.000'), true);
  assert.equal(stockBoundsValid('1.000', null), true);
});
test('IDs dentro de BIGINT de PostgreSQL', () => {
  assert.equal(validId('9223372036854775807'), true);
  for (const value of ['0', '-1', '1.2', 'abc', '9223372036854775808', '9'.repeat(1000)]) {
    assert.equal(validId(value), false, value);
  }
});
