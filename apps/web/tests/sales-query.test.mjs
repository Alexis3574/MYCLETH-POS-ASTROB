import test from 'node:test'
import assert from 'node:assert/strict'
import { isSaleId, readSalesQuery, salesSearch, validateSalesFilters, formatSaleDate } from '../src/features/sales/sales.query.ts'
const filters = { folio: '', fecha_desde: '', fecha_hasta: '', estado: '', condicion_pago: '' }

test('los filtros sobreviven a listado → detalle → listado sin incorporar parámetros ajenos', () => {
  const original = { ...filters, page: 3, limit: 50, folio: 'VEN / & # 001', estado: 'CANCELADA' }
  const search = salesSearch(original)
  assert.deepEqual(readSalesQuery(new URLSearchParams(search)).query, original)
  const unsafe = readSalesQuery(new URLSearchParams(search + '&token=secreto&empresa_id=otra'))
  assert.equal(salesSearch(unsafe.query), search)
})
test('fechas de calendario reales y rango ordenado, sin heredar el límite del dashboard', () => {
  assert.equal(validateSalesFilters({ ...filters, fecha_desde: '2026-01-01', fecha_hasta: '2026-12-31' }), null)
  assert.match(validateSalesFilters({ ...filters, fecha_desde: '2026-02-29' }), /no es válida/)
  assert.equal(validateSalesFilters({ ...filters, fecha_desde: '2024-02-29' }), null)
  assert.match(validateSalesFilters({ ...filters, fecha_desde: '2026-11-10', fecha_hasta: '2026-11-09' }), /posterior/)
})
test('una sola fecha se conserva porque la API admite límites independientes', () => {
  const result = readSalesQuery(new URLSearchParams('fecha_hasta=2026-11-10'))
  assert.equal(result.error, null)
  assert.equal(result.query.fecha_desde, '')
  assert.equal(result.query.fecha_hasta, '2026-11-10')
})
test('URLs con paginación inválida no provocan solicitudes al servidor', () => {
  for (const search of ['page=0', 'page=1.5', 'page=Infinity', 'page=9007199254740992', 'limit=101', 'limit=0']) {
    assert.ok(readSalesQuery(new URLSearchParams(search)).error, search)
  }
  assert.equal(readSalesQuery(new URLSearchParams('page=4&limit=100')).error, null)
})
test('el detalle preserva precisión de identificadores BIGINT y rechaza rutas no válidas', () => {
  assert.equal(isSaleId('9223372036854775807'), true)
  for (const id of ['9223372036854775808', '0', '-1', '1/returns', '1.5', '01', 'x']) assert.equal(isSaleId(id), false, id)
})
test('no se aceptan filtros de estado o pago ajenos al alcance de consulta', () => {
  assert.ok(readSalesQuery(new URLSearchParams('estado=OTRO')).error)
  assert.ok(readSalesQuery(new URLSearchParams('condicion_pago=EFECTIVO')).error)
  assert.equal(readSalesQuery(new URLSearchParams('condicion_pago=CREDITO')).error, null)
})
test('la fecha conserva el día UTC del filtro, independientemente del huso local', () => {
  assert.match(formatSaleDate('2026-11-10T00:15:00Z'), /10.*nov.*2026/)
})
