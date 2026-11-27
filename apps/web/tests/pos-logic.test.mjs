import test from 'node:test'
import assert from 'node:assert/strict'
import { addProduct, buildSaleInput, estimateSale, lineError } from '../src/features/pos/pos.logic.ts'
import { readPendingSale, savePendingSale, clearPendingSale } from '../src/features/pos/submission.guard.ts'

const product = {
  id: '9223372036854775807', empresa_id: '1', nombre: 'Artículo', sku: 'SKU', codigo_barras: null,
  tipo: 'PRODUCTO', activo: true, controla_inventario: true, precio_venta: '100.00',
  unidad_medida: { nombre: 'Pieza', codigo: 'PZA', activo: true, permite_decimales: true },
  impuestos: [{ id: '1', tasa: '16.0000', activo: true }, { id: '2', tasa: '8.0000', activo: false }],
}
const warehouse = { id: '1', nombre: 'Almacén', codigo: 'A', activo: true, sucursal: { id: '2', empresa_id: '1', nombre: 'Sucursal', codigo: 'S', activo: true } }
const method = { id: '1', codigo: 'TRANSFERENCIA', nombre: 'Transferencia', activo: true, es_efectivo: false }
function draft() { return {
  companyId: '1', userId: '3', warehouse, customer: null, cash: null, folio: ' V-001 ', notes: '',
  lines: [{ product, quantity: '1', discount: '0' }], payments: [{ key: 1, methodId: '1', amount: '116.00', reference: '' }], methods: [method],
} }
test('la solicitud conserva BIGINT y no envía precios, impuestos, totales ni identidad de usuario', () => {
  const input = buildSaleInput(draft())
  assert.equal(input.detalles[0].producto_id, '9223372036854775807')
  assert.equal(input.folio, 'V-001')
  assert.deepEqual(Object.keys(input.detalles[0]).sort(), ['cantidad', 'descuento_porcentaje', 'producto_id'])
  assert.equal('total' in input, false)
  assert.equal('usuario_id' in input, false)
})
test('redondeo por línea, descuento antes del impuesto y suma de impuestos activos', () => {
  const lines = [{ product, quantity: '3', discount: '10' }]
  assert.deepEqual(estimateSale(lines), { subtotal: 300, descuento: 30, impuesto: 43.2, total: 313.2 })
  const fractional = { ...product, precio_venta: '0.05', controla_inventario: false }
  assert.deepEqual(estimateSale([{ product: fractional, quantity: '1', discount: '10' }]), { subtotal: 0.05, descuento: 0.01, impuesto: 0.01, total: 0.05 })
})
test('límites de cantidad y precisión, sin coerción de vacíos o exponentes', () => {
  for (const quantity of ['', '0', '-1', '1e3', 'NaN', 'Infinity', '1.0001', '9999999999999']) assert.ok(lineError({ product, quantity, discount: '0' }), quantity)
  assert.ok(lineError({ product, quantity: '1.5', discount: '0' }))
  assert.equal(lineError({ product: { ...product, controla_inventario: false }, quantity: '1.125', discount: '0' }), null)
  assert.ok(lineError({ product: { ...product, controla_inventario: false, unidad_medida: { ...product.unidad_medida, permite_decimales: false } }, quantity: '1.5', discount: '0' }))
})
test('descuento validado, incluidos límites, y cantidades inválidas no generan estimación', () => {
  for (const discount of ['-1', '100.0001', '0.00001', '', '1e1']) assert.ok(lineError({ product, quantity: '1', discount }))
  assert.equal(lineError({ product, quantity: '1', discount: '100' }), null)
  assert.equal(estimateSale([{ product, quantity: '', discount: '0' }]), null)
})
test('agregar el mismo producto acumula una línea y conserva el descuento', () => {
  const lines = [{ product, quantity: '2', discount: '10' }]
  const next = addProduct(lines, product)
  assert.equal(next.length, 1); assert.equal(next[0].quantity, '3'); assert.equal(next[0].discount, '10')
  assert.equal(lines[0].quantity, '2')
})
test('almacén, sucursal y productos pertenecen a la empresa de la sesión', () => {
  assert.throws(() => buildSaleInput({ ...draft(), warehouse: null }), /almacén/)
  assert.throws(() => buildSaleInput({ ...draft(), warehouse: { ...warehouse, sucursal: { ...warehouse.sucursal, empresa_id: '9' } } }), /empresa/)
  assert.throws(() => buildSaleInput({ ...draft(), lines: [{ product: { ...product, empresa_id: '9' }, quantity: '1', discount: '0' }] }), /empresa/)
})
test('se rechazan carrito vacío, productos duplicados o inactivos y folios inválidos', () => {
  assert.throws(() => buildSaleInput({ ...draft(), lines: [] }), /producto/)
  assert.throws(() => buildSaleInput({ ...draft(), lines: [...draft().lines, ...draft().lines] }), /duplicados/)
  assert.throws(() => buildSaleInput({ ...draft(), lines: [{ ...draft().lines[0], product: { ...product, activo: false } }] }), /inactivos/)
  for (const folio of ['', ' ', 'x'.repeat(51)]) assert.throws(() => buildSaleInput({ ...draft(), folio }), /folio/)
})
test('crédito exige cliente y su condición la decide el backend según el método', () => {
  const credit = { ...draft(), methods: [{ ...method, codigo: 'CREDITO' }] }
  assert.throws(() => buildSaleInput(credit), /requiere cliente/)
  const input = buildSaleInput({ ...credit, customer: { id: '4', activo: true } })
  assert.equal(input.cliente_id, '4'); assert.equal('condicion_pago' in input, false)
})
test('efectivo exige sesión propia, abierta, activa y de la sucursal seleccionada', () => {
  const cashDraft = { ...draft(), methods: [{ ...method, es_efectivo: true }] }
  assert.throws(() => buildSaleInput(cashDraft), /sesión abierta/)
  const cash = { register: { id: '5', sucursal_id: '2', activo: true }, session: { id: '6', caja_id: '5', estado: 'ABIERTA', fecha_cierre: null, usuario_apertura_id: '3' } }
  assert.equal(buildSaleInput({ ...cashDraft, cash }).sesion_caja_id, '6')
  for (const session of [{ ...cash.session, estado: 'CERRADA' }, { ...cash.session, usuario_apertura_id: '9' }, { ...cash.session, fecha_cierre: '2026-01-01' }, { ...cash.session, caja_id: '9' }]) {
    assert.throws(() => buildSaleInput({ ...cashDraft, cash: { ...cash, session } }), /sesión abierta/)
  }
  assert.throws(() => buildSaleInput({ ...cashDraft, cash: { ...cash, register: { ...cash.register, sucursal_id: '9' } } }), /sesión abierta/)
})
test('pagos exactos en centavos, positivos y métodos activos', () => {
  for (const amount of ['115.99', '116.01', '116.001', '0', '-1', '', '1e2']) assert.throws(() => buildSaleInput({ ...draft(), payments: [{ ...draft().payments[0], amount }] }))
  assert.throws(() => buildSaleInput({ ...draft(), methods: [{ ...method, activo: false }] }), /método/)
  assert.throws(() => buildSaleInput({ ...draft(), payments: [] }), /pago/)
  const input = buildSaleInput({ ...draft(), payments: [{ key: 1, methodId: '1', amount: '58', reference: '' }, { key: 2, methodId: '1', amount: '58.00', reference: ' ABC ' }] })
  assert.equal(input.pagos.length, 2); assert.equal(input.pagos[1].referencia, 'ABC')
})
test('el intento incierto conserva solo folio y ámbito y puede recuperarse al recargar', () => {
  const data = new Map(), storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) }
  assert.equal(readPendingSale(storage), null)
  const pending = { companyId: '1', branchId: '2', folio: 'V-001' }
  savePendingSale(storage, pending); assert.deepEqual(readPendingSale(storage), pending)
  clearPendingSale(storage); assert.equal(readPendingSale(storage), null)
  assert.ok(readPendingSale({ getItem: () => '{invalid' }))
  assert.throws(() => savePendingSale({ setItem: () => { throw new Error('blocked') } }, pending))
})
