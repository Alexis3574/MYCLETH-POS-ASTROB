import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteIdSchema, quoteCreateSchema, quoteUpdateSchema, quoteListSchema } from '../../src/modules/quotes/quote.schema.js';
import { decimalString, ensureLineFits, quoteTransitionAllowed, jsonSafe, todayInZone } from '../../src/modules/quotes/utils/quote-values.js';

const base = {
  sucursal_id: '1', folio: 'CT-2026-01',
  detalles: [{ producto_id: '2', cantidad: '1.000', descuento_porcentaje: '0.0000' }],
};

test('ID BIGINT exacto en rango', () => assert.equal(quoteIdSchema.parse('9223372036854775807'), 9223372036854775807n));
test('rechaza IDs fuera de BIGINT, cero y notación exponencial', () => {
  for (const value of ['0', '-1', '1.0', '1e3', '9223372036854775808']) assert.equal(quoteIdSchema.safeParse(value).success, false);
});
test('decimales sin redondeo implícito', () => {
  assert.equal(decimalString('1.2', 3, true), '1.200');
  assert.equal(decimalString('0.0001', 3, true), null);
  assert.equal(decimalString('1e3', 4), null);
});
test('no permite precios ni cantidades fuera de rango', () => {
  assert.equal(decimalString('99999999999.999', 3, true), '99999999999.999');
  assert.equal(decimalString('100000000000', 3, true), null);
});
test('crear cotización válida; evita empresa y usuario inyectados', () => {
  assert.equal(quoteCreateSchema.safeParse(base).success, true);
  assert.equal(quoteCreateSchema.safeParse({ ...base, empresa_id: '99' }).success, false);
  assert.equal(quoteCreateSchema.safeParse({ ...base, usuario_id: '99' }).success, false);
});
test('rechaza productos duplicados', () => {
  assert.equal(quoteCreateSchema.safeParse({ ...base, detalles: [base.detalles[0], base.detalles[0]] }).success, false);
});
test('rechaza cantidad decimal con más de 3 cifras', () => {
  assert.equal(quoteCreateSchema.safeParse({ ...base, detalles: [{ producto_id: '2', cantidad: '1.0001' }] }).success, false);
});
test('rechaza porcentaje negativo o mayor que 100', () => {
  for (const discount of ['100.0001', '-1']) assert.equal(quoteCreateSchema.safeParse({ ...base, detalles: [{ producto_id: '2', cantidad: '1', descuento_porcentaje: discount }] }).success, false);
});
test('no permite precio, tasas o totales proporcionados por cliente', () => {
  assert.equal(quoteCreateSchema.safeParse({ ...base, detalles: [{ producto_id: '2', cantidad: '1', precio_unitario: '0.00' }] }).success, false);
});
test('modificación estricta y no vacía', () => {
  assert.equal(quoteUpdateSchema.safeParse({}).success, false);
  assert.equal(quoteUpdateSchema.safeParse({ folio: 'OTRO' }).success, false);
  assert.equal(quoteUpdateSchema.safeParse({ observaciones: 'Revisada' }).success, true);
});
test('filtros estrictos, paginación, estado', () => {
  assert.equal(quoteListSchema.safeParse({ page: '1', pageSize: '10', estado: 'ENVIADA' }).success, true);
  assert.equal(quoteListSchema.safeParse({ empresa_id: '1' }).success, false);
  assert.equal(quoteListSchema.safeParse({ pageSize: '101' }).success, false);
});
test('serializa BigInt en respuesta JSON', () => assert.deepEqual(jsonSafe({ id: 99n }), { id: '99' }));
test('mantiene transiciones de estado limitadas', () => {
  assert.equal(quoteTransitionAllowed('BORRADOR', 'send'), true);
  assert.equal(quoteTransitionAllowed('ACEPTADA', 'send'), false);
  assert.equal(quoteTransitionAllowed('ENVIADA', 'accept'), true);
  assert.equal(quoteTransitionAllowed('CONVERTIDA', 'cancel'), false);
});
test('impide desbordamiento de importes', () => {
  assert.throws(() => ensureLineFits('99999999999.999', '9999999999.0000', '0', '0'));
  assert.doesNotThrow(() => ensureLineFits('2.000', '150.0000', '10.0000', '16.0000'));
});
test('fecha local formateada como ISO', () => assert.match(todayInZone('America/Mexico_City'), /^\d{4}-\d{2}-\d{2}$/));
