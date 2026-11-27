import test from 'node:test'
import assert from 'node:assert/strict'
import { estimateReturn, returnBalances, buildReturn, distributeRefund } from '../src/features/sales/returns/returns.logic.ts'
import { parseReturns } from '../src/features/sales/returns/returns.parse.ts'
import { readAction, saveAction, clearAction, returnFingerprint, matchesPendingReturn } from '../src/features/sales/returns/action.guard.ts'
import { createFixtureState } from './pos-fixture-state.mjs'

const product = { id: '9007199254740993', nombre: 'Artículo', sku: 'SKU', codigo_barras: null }
const paymentMethod = { id: '1', codigo: 'TRANSFERENCIA', nombre: 'Transferencia', es_efectivo: false }
function sale() { return { id: '99', empresa: { id: '1' }, folio: 'V-1', estado: 'COMPLETADA', total: 348,
  sucursal: { id: '2' }, detalles: [{ id: '1', producto_id: product.id, producto: product, descripcion: null, cantidad: 3,
    subtotal_linea: 300, descuento_importe: 0, impuesto_importe: 48, total_linea: 348 }],
  pagos: [{ id: '1', monto: 100, metodo_pago: paymentMethod }, { id: '2', monto: 248, metodo_pago: paymentMethod }] } }
function record(quantity = 1, total = 116) { return { id: '201', venta_id: '99', usuario_id: '3', folio: 'D-1', motivo: 'Prueba', fecha: '2026-11-19T12:00:00Z', total,
  detalles: [{ id: '1', venta_detalle_id: '1', cantidad: quantity, subtotal_linea: 100, descuento_importe: 0, impuesto_importe: 16, total_linea: total, producto: product }],
  reembolsos: [{ id: '1', venta_pago_id: '2', monto: total, referencia: null, metodo_pago: paymentMethod }] } }
function values() { return { folio: ' D-2 ', reason: ' devolución de prueba ', quantities: { '1': '1' },
  refunds: { '1': { amount: '100', reference: '' }, '2': { amount: '16', reference: ' REF ' } }, cash: null, userId: '3', companyId: '1' } }

test('saldos consideran devoluciones y reembolsos anteriores por línea y pago, sin perder BIGINT', () => {
  const balances = returnBalances(sale(), [record()])
  assert.equal(balances.items[0].available, 2)
  assert.equal(balances.items[0].item.producto.id, '9007199254740993')
  assert.deepEqual(balances.payments.map(row => row.available), [100, 132])
  assert.throws(() => returnBalances(sale(), [{ ...record(), venta_id: '88' }]))
  assert.throws(() => returnBalances(sale(), [record(4, 464)]))
})
test('devolución parcial proporcional y última devolución absorben el remanente de centavos', () => {
  const original = sale(); original.total = 0.05; original.detalles[0].total_linea = 0.05
  const first = record(1, 0.02), second = { ...record(1, 0.02), id: '202' }
  assert.equal(estimateReturn(original, [], { '1': '1' }).total, 0.02)
  assert.equal(estimateReturn(original, [first, second], { '1': '1' }).total, 0.01)
  assert.equal(estimateReturn(sale(), [record()], { '1': '2' }).total, 232)
})
test('cantidades inválidas, excesivas o de otra línea se rechazan antes de enviar', () => {
  for (const text of ['-1', '4', '1e1', '1.0001', 'NaN', 'Infinity']) assert.throws(() => estimateReturn(sale(), [], { '1': text }), text)
  assert.throws(() => estimateReturn(sale(), [], { '88': '1' }))
  assert.equal(estimateReturn(sale(), [], { '1': '' }).total, 0)
  assert.equal(estimateReturn(sale(), [], { '1': '0' }).details.length, 0)
})
test('distribución limita cada reembolso al pago original y conserva suma exacta', () => {
  const refunds = distributeRefund(116, returnBalances(sale(), []).payments)
  assert.deepEqual(refunds, { '1': { amount: '100.00', reference: '' }, '2': { amount: '16.00', reference: '' } })
  const request = buildReturn(sale(), [], values())
  assert.equal(request.folio, 'D-2'); assert.equal(request.motivo, 'devolución de prueba')
  assert.deepEqual(request.reembolsos.map(row => row.monto), ['100.00', '16.00'])
  assert.equal('total' in request, false); assert.equal('usuario_id' in request, false)
})
test('folio, motivo, estado, empresa y reembolsos se comprueban sin coerciones peligrosas', () => {
  for (const patch of [{ folio: '' }, { reason: 'ab' }, { companyId: '9' }, { refunds: {} },
    { refunds: { '1': { amount: '116', reference: '' } } }, { refunds: { '2': { amount: '115.99', reference: '' } } },
    { refunds: { '2': { amount: '1e2', reference: '' } } }]) assert.throws(() => buildReturn(sale(), [], { ...values(), ...patch }))
  assert.throws(() => buildReturn({ ...sale(), estado: 'CANCELADA' }, [], values()))
})
test('efectivo exige caja propia abierta y de la sucursal', () => {
  const original = sale(); original.pagos = [{ id: '1', monto: 348, metodo_pago: { ...paymentMethod, es_efectivo: true } }]
  const draft = { ...values(), refunds: { '1': { amount: '116', reference: '' } } }
  assert.throws(() => buildReturn(original, [], draft), /sesión propia/)
  const cash = { register: { id: '5', activo: true, sucursal_id: '2' }, session: { id: '6', caja_id: '5', estado: 'ABIERTA', fecha_cierre: null, usuario_apertura_id: '3' } }
  assert.equal(buildReturn(original, [], { ...draft, cash }).sesion_caja_id, '6')
  for (const changed of [{ ...cash, register: { ...cash.register, sucursal_id: '9' } }, { ...cash, session: { ...cash.session, usuario_apertura_id: '9' } },
    { ...cash, session: { ...cash.session, estado: 'CERRADA' } }]) assert.throws(() => buildReturn(original, [], { ...draft, cash: changed }))
})
test('respuestas incompletas y registros duplicados no habilitan una devolución', () => {
  const valid = { ok: true, data: { venta: { id: '99', estado: 'COMPLETADA', folio: 'V-1', total: 348 }, total_devoluciones: 1, total_devuelto: 116, devoluciones: [record()] } }
  assert.equal(parseReturns(valid, '99').devoluciones[0].folio, 'D-1')
  for (const value of [null, {}, { ok: true, data: {} }, { ...valid, data: { ...valid.data, devoluciones: [{}] } },
    { ...valid, data: { ...valid.data, total_devoluciones: 2, devoluciones: [record(), record()] } }]) assert.throws(() => parseReturns(value, '99'))
})
test('la protección persiste ámbito, tipo y folio; registros dañados conservan el bloqueo', () => {
  let raw = null
  const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value }, removeItem: () => { raw = null } }
  assert.equal(readAction(storage), null)
  saveAction(storage, { companyId: '1', userId: '3', saleId: '99', action: 'return', folio: 'D-2', knownReturnIds: ['201'] })
  assert.equal(readAction(storage).action, 'return')
  for (const value of ['{}', 'null', '{', '[]', '123']) { raw = value; assert.notEqual(readAction(storage), null) }
  clearAction(storage); assert.equal(readAction(storage), null)
})

const url = path => new URL('http://fixture/api/v1' + path)
function seed(state, folio = 'RET-SALE', paymentId = '1') {
  const result = state.handle('POST', url('/sales'), 'normal', { empresa_id: '1', sucursal_id: '2', almacen_id: '1', folio,
    sesion_caja_id: paymentId === '2' ? '6' : null, detalles: [{ producto_id: '9007199254740993', cantidad: '3', descuento_porcentaje: '0' }],
    pagos: [{ metodo_pago_id: paymentId, monto: '348.00', referencia: null }] })
  assert.equal(result.status, 201); return result.body.data
}
function refund(folio, amount = '116.00', quantity = '1') { return { folio, motivo: 'Prueba aislada', sesion_caja_id: null,
  detalles: [{ venta_detalle_id: '1', cantidad: quantity }], reembolsos: [{ venta_pago_id: '1', monto: amount, referencia: null }] } }
test('simulador: devolución parcial y remanente total, consulta y stock restaurado sin doble reintegro', () => {
  const state = createFixtureState(), original = seed(state)
  const path = '/sales/' + original.id
  assert.equal(state.handle('POST', url(path + '/returns'), 'normal', refund('R-1')).status, 201)
  assert.equal(state.handle('POST', url(path + '/returns'), 'normal', refund('R-2', '232.00', '2')).status, 201)
  const history = state.handle('GET', url(path + '/returns'))
  assert.equal(parseReturns(history.body, original.id).devoluciones.length, 2)
  assert.equal(state.handle('POST', url(path + '/returns'), 'normal', refund('R-3')).status, 409)
  assert.equal(state.handle('PATCH', url(path + '/cancel')).status, 409)
  assert.equal(state.handle('GET', url('/inventory/stock?almacen_id=1&producto_id=9007199254740993')).body.data[0].disponible, '100.000')
  assert.equal(state.handle('GET', url(path + '/financial-summary')).body.data.resumen.total_neto_venta, 0)
})
test('simulador: cancelación una sola vez y respuesta incierta consultable', () => {
  const state = createFixtureState(), original = seed(state)
  const path = '/sales/' + original.id
  assert.equal(state.handle('PATCH', url(path + '/cancel'), 'cancel-uncertain').status, 503)
  assert.equal(state.handle('GET', url(path)).body.data.estado, 'CANCELADA')
  assert.equal(state.handle('PATCH', url(path + '/cancel')).status, 409)
  assert.equal(state.handle('POST', url(path + '/returns'), 'normal', refund('R-1')).status, 409)
})
test('simulador: permisos independientes, historial malformado y devolución incierta no se duplican', () => {
  const state = createFixtureState(), original = seed(state), path = '/sales/' + original.id
  assert.equal(state.handle('POST', url(path + '/returns'), 'read-only', refund('R-1')).status, 403)
  assert.equal(state.handle('PATCH', url(path + '/cancel'), 'read-only').status, 403)
  assert.throws(() => parseReturns(state.handle('GET', url(path + '/returns'), 'returns-malformed').body, original.id))
  assert.equal(state.handle('POST', url(path + '/returns'), 'normal', refund('UNCERTAIN-R1')).status, 503)
  assert.equal(state.handle('GET', url(path + '/returns')).body.data.total_devoluciones, 1)
  assert.equal(state.handle('POST', url(path + '/returns'), 'normal', refund('UNCERTAIN-R1')).status, 409)
})

test('la recuperación exige folio, usuario, cantidades e importes del intento, no solo una coincidencia de folio', () => {
  const returned = record()
  const pending = { companyId: '1', userId: '3', saleId: '99', action: 'return', folio: 'D-1', knownReturnIds: [], expected: returnFingerprint(returned.detalles, returned.reembolsos) }
  assert.equal(matchesPendingReturn(pending, returned), true)
  assert.equal(matchesPendingReturn(pending, { ...returned, usuario_id: '9' }), false)
  assert.equal(matchesPendingReturn({ ...pending, knownReturnIds: ['201'] }, returned), false)
  assert.equal(matchesPendingReturn(pending, { ...returned, detalles: [{ ...returned.detalles[0], cantidad: 2 }] }), false)
  assert.equal(matchesPendingReturn(pending, { ...returned, reembolsos: [{ ...returned.reembolsos[0], monto: 115 }] }), false)
  assert.equal(matchesPendingReturn({ ...pending, expected: undefined }, returned), false)
})

test('simulador: el resumen de efectivo descuenta el reembolso sin repetir la salida física', () => {
  const state = createFixtureState(), original = seed(state, 'CASH-REFUND', '2')
  const result = state.handle('POST', url('/sales/' + original.id + '/returns'), 'normal', { ...refund('CASH-R', '348.00', '3'), sesion_caja_id: '6' })
  assert.equal(result.status, 201)
  const summary = state.handle('GET', url('/sales/' + original.id + '/financial-summary')).body.data
  assert.equal(summary.resumen.total_neto_venta, 0)
  assert.equal(summary.efectivo.devuelto, 348)
  assert.equal(summary.efectivo.neto, 0)
})
