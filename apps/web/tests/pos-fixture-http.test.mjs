import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startPosFixture } from './pos-browser-fixture.mjs'

let fixture
before(async () => { fixture = await startPosFixture(0) })
after(async () => { await fixture?.server.close() })
async function request(path, { method = 'GET', body, scenario = 'normal' } = {}) {
  const response = await fetch(fixture.url + '/api/v1' + path, { method, headers: { Authorization: 'Bearer fixture-' + scenario,
    ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  return { status: response.status, body: await response.json() }
}
function sale(folio, overrides = {}) { return { empresa_id: '1', sucursal_id: '2', almacen_id: '1', cliente_id: null, sesion_caja_id: null,
  folio, observaciones: 'Prueba sintética', detalles: [{ producto_id: '9007199254740993', cantidad: '1', descuento_porcentaje: '0' }],
  pagos: [{ metodo_pago_id: '1', monto: '116.00', referencia: null }], ...overrides } }

test('el catálogo simulado respeta búsqueda, estado, paginación y BIGINT', async () => {
  const first = await request('/products?activo=true&page=1&limit=20')
  assert.equal(first.status, 200); assert.equal(first.body.data.length, 20); assert.equal(first.body.pagination.total, 22)
  const second = await request('/products?activo=true&page=2&limit=20')
  assert.equal(second.body.data.length, 2)
  const search = await request('/products?search=750001&activo=true')
  assert.equal(search.body.data.length, 1); assert.equal(search.body.data[0].id, '9007199254740993')
  const inactive = await request('/products?activo=false')
  assert.equal(inactive.body.data[0].sku, 'INACTIVO')
})
test('captura mixta: cantidades, descuento, servicio fraccionario, dos pagos y detalle consultable', async () => {
  const result = await request('/sales', { method: 'POST', body: sale('HTTP-MIX', {
    detalles: [{ producto_id: '9007199254740993', cantidad: '3', descuento_porcentaje: '10' }, { producto_id: '40', cantidad: '1.25', descuento_porcentaje: '0' }],
    pagos: [{ metodo_pago_id: '1', monto: '100.00', referencia: 'A' }, { metodo_pago_id: '1', monto: '275.70', referencia: 'B' }],
  }) })
  assert.equal(result.status, 201)
  assert.equal(result.body.data.subtotal, 362.5); assert.equal(result.body.data.descuento, 30)
  assert.equal(result.body.data.impuesto, 43.2); assert.equal(result.body.data.total, 375.7)
  const detail = await request('/sales/' + result.body.data.id)
  assert.equal(detail.body.data.detalles.length, 2); assert.equal(detail.body.data.pagos.length, 2)
  const stock = await request('/inventory/stock?almacen_id=1&producto_id=9007199254740993')
  assert.equal(stock.body.data[0].disponible, '97.000')
})
test('efectivo: sesión propia válida, rechazo de otra persona, sesión cerrada y sin sesión', async () => {
  const input = sale('HTTP-CASH', { sesion_caja_id: '6', pagos: [{ metodo_pago_id: '2', monto: '116.00', referencia: null }] })
  for (const scenario of ['cash-other', 'cash-closed', 'cash-none']) {
    const result = await request('/sales', { method: 'POST', body: input, scenario })
    assert.equal(result.status, 422, scenario)
  }
  const result = await request('/sales', { method: 'POST', body: input })
  assert.equal(result.status, 201); assert.equal(result.body.data.sesion_caja.id, '6')
})
test('crédito exige cliente activo y conserva la condición y el resumen financiero', async () => {
  const input = sale('HTTP-CREDIT', { pagos: [{ metodo_pago_id: '3', monto: '116.00', referencia: null }] })
  assert.equal((await request('/sales', { method: 'POST', body: input })).status, 422)
  assert.equal((await request('/sales', { method: 'POST', body: { ...input, cliente_id: '9' } })).status, 422)
  const result = await request('/sales', { method: 'POST', body: { ...input, cliente_id: '8' } })
  assert.equal(result.status, 201); assert.equal(result.body.data.condicion_pago, 'CREDITO')
  const financial = await request('/sales/' + result.body.data.id + '/financial-summary')
  assert.equal(financial.body.data.credito.monto_neto_post_devoluciones, 116)
  const unavailable = await request('/sales/' + result.body.data.id + '/financial-summary', { scenario: 'financial-error' })
  assert.equal(unavailable.status, 500)
  assert.equal((await request('/sales/' + result.body.data.id)).status, 200)
})
test('rechazos por stock y pagos no registran ventas ni descuentan existencias', async () => {
  const before = fixture.stats().sales
  const stockBefore = (await request('/inventory/stock?almacen_id=1&producto_id=9007199254740993')).body.data[0].disponible
  const excessive = sale('HTTP-STOCK', { detalles: [{ producto_id: '9007199254740993', cantidad: '200', descuento_porcentaje: '0' }] })
  assert.equal((await request('/sales', { method: 'POST', body: excessive })).status, 422)
  assert.equal((await request('/sales', { method: 'POST', body: sale('HTTP-PAY', { pagos: [{ metodo_pago_id: '1', monto: '115.99' }] }) })).status, 422)
  assert.equal(fixture.stats().sales, before)
  assert.equal((await request('/inventory/stock?almacen_id=1&producto_id=9007199254740993')).body.data[0].disponible, stockBefore)
})
test('folio duplicado: conflicto sin segunda venta', async () => {
  const before = fixture.stats().sales
  assert.equal((await request('/sales', { method: 'POST', body: sale('HTTP-MIX') })).status, 409)
  assert.equal(fixture.stats().sales, before)
  assert.equal((await request('/sales?folio=HTTP-MIX')).body.pagination.total, 1)
})
test('respuesta 503 después de registrar: el folio sí existe y un reenvío produce conflicto', async () => {
  assert.equal((await request('/sales', { method: 'POST', body: sale('UNCERTAIN') })).status, 503)
  const found = await request('/sales?folio=UNCERTAIN')
  assert.equal(found.body.pagination.total, 1)
  assert.equal((await request('/sales', { method: 'POST', body: sale('UNCERTAIN') })).status, 409)
})
test('conexión perdida y respuesta incompleta conservan operaciones consultables en el simulador', async () => {
  await assert.rejects(request('/sales', { method: 'POST', body: sale('NETWORK-LOST') }))
  assert.equal((await request('/sales?folio=NETWORK-LOST')).body.pagination.total, 1)
  const malformed = await request('/sales', { method: 'POST', body: sale('MALFORMED') })
  assert.equal(malformed.status, 201); assert.deepEqual(Object.keys(malformed.body.data), ['id'])
  assert.equal((await request('/sales?folio=MALFORMED')).body.pagination.total, 1)
})
test('permiso de caja independiente y errores HTTP 401/403/404 comprobables', async () => {
  assert.equal((await request('/cash', { scenario: 'cash-only' })).status, 200)
  assert.equal((await request('/products', { scenario: 'cash-only' })).status, 403)
  assert.equal((await request('/products', { scenario: 'expired' })).status, 401)
  assert.equal((await request('/sales/999999')).status, 404)
  assert.equal((await request('/sales?condicion_pago=CREDITO')).body.data.every((item) => item.condicion_pago === 'CREDITO'), true)
})

test('folio automático, reintentos concurrentes y recuperación del resultado en el simulador', async () => {
  const before = fixture.stats().sales
  const body = sale(undefined, { clave_idempotencia: '22222222-2222-4222-8222-222222222222' })
  const results = await Promise.all(Array.from({ length: 5 }, () => request('/sales', { method: 'POST', body })))
  assert.ok(results.every(item => [200, 201].includes(item.status)))
  assert.equal(new Set(results.map(item => item.body.data.id)).size, 1)
  assert.equal(fixture.stats().sales, before + 1)
  assert.match(results[0].body.data.folio, /^VTA-2-20261119-/)
  const recovered = await request('/sales/operations/' + body.clave_idempotencia)
  assert.equal(recovered.body.data.id, results[0].body.data.id)
  assert.equal((await request('/sales', { method: 'POST', body: { ...body, observaciones: 'Otro contenido' } })).status, 409)
  assert.equal((await request('/sales/operations/33333333-3333-4333-8333-333333333333')).status, 404)
})
