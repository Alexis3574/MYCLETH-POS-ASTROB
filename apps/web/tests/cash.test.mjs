import test from 'node:test'
import assert from 'node:assert/strict'
import { cashCents, cashAmount, cashInput, cashNotes, cashMovementInput, matchesCashAttempt, readCashAttempt, saveCashAttempt, clearCashAttempt } from '../src/features/cash/cash.logic.ts'
import { parseCashSession, parseCashDetail, parseCashMovement, parseCashPage } from '../src/features/cash/cash.parse.ts'
import { allCashRows, latestCashSessionId } from '../src/features/cash/cash.history.ts'
import { createCashFixtureState } from './cash-fixture-state.mjs'

const session = () => ({ id: '9007199254740993', caja_id: '5', usuario_apertura_id: '3', usuario_cierre_id: null, fecha_apertura: '2026-11-22T12:00:00Z', fecha_cierre: null, estado: 'ABIERTA', monto_apertura: '500.00', monto_esperado: null, monto_cierre: null, diferencia: null, notas: null })
const openAttempt = () => ({ companyId: '1', userId: '3', action: { kind: 'open', cashId: '5', previousMaxId: '9007199254740992', body: { monto_apertura: '500.00', notas: null } } })
const moveAttempt = () => ({ companyId: '1', userId: '3', action: { kind: 'move', cashId: '5', sessionId: session().id, body: { tipo: 'ENTRADA', concepto: 'Fondo adicional', monto: '25.10', referencia: 'UNICA-1' } } })
const movement = () => ({ id: '9007199254741000', sesion_caja_id: session().id, usuario_id: '3', tipo: 'ENTRADA', concepto: 'Fondo adicional', monto: '25.10', referencia: 'MANUAL:UNICA-1', fecha: '2026-11-22T13:00:00Z' })
const url = path => new URL('http://fixture/api/v1' + path)
const opening = { monto_apertura: '100.10', notas: 'Prueba aislada' }

test('caja: importes exactos en centavos, máximos y diferencias negativas', () => {
  assert.equal(cashAmount(cashCents('0.1') + cashCents('0.2')), '0.30')
  assert.equal(cashInput(' 999999999999.99 '), '999999999999.99')
  assert.equal(cashAmount(-123), '-1.23')
  assert.equal(cashInput('0'), '0.00')
  assert.throws(() => cashInput('0', true))
  for (const input of ['', '-1', '1e2', 'NaN', 'Infinity', '01', '1.001', '1000000000000', '1,00']) assert.throws(() => cashInput(input), input)
  assert.throws(() => cashCents('90071992547409.92'))
})
test('caja: concepto, referencia y notas respetan los contratos sin campos inventados', () => {
  assert.deepEqual(cashMovementInput('SALIDA', '10.1', ' Retiro local ', ' REF '), { tipo: 'SALIDA', monto: '10.10', concepto: 'Retiro local', referencia: 'REF' })
  assert.equal(cashNotes('  '), null)
  assert.throws(() => cashNotes('a'.repeat(1501)))
  for (const args of [['VENTA','1','concepto','REF'], ['ENTRADA','0','concepto','REF'], ['ENTRADA','1','ab','REF'], ['ENTRADA','1','concepto','ab']]) assert.throws(() => cashMovementInput(...args))
})
test('caja: parser conserva BIGINT, estados y montos; rechaza cierres incompletos', () => {
  assert.equal(parseCashSession(session(), '5').id, '9007199254740993')
  for (const patch of [{ id: 9007199254740992 }, { caja_id: '6' }, { estado: 'DESCONOCIDO' }, { monto_apertura: -1 }, { fecha_apertura: 'fecha' }, { estado: 'CERRADA' }]) assert.throws(() => parseCashSession({ ...session(), ...patch }, '5'))
  const closed = { ...session(), estado: 'CERRADA', fecha_cierre: '2026-11-22T13:00:00Z', usuario_cierre_id: '3', monto_esperado: '500.10', monto_cierre: '500', diferencia: '-0.10' }
  assert.equal(parseCashSession(closed).diferencia, '-0.10')
  assert.throws(() => parseCashSession({ ...closed, diferencia: '0' }))
})
test('caja: detalle y movimientos no aceptan otra caja, sesión o resumen duplicado', () => {
  const detail = { ...session(), caja: { id: '5', sucursal_id: '2', codigo: 'C-1', activo: true }, monto_esperado_actual: '500', resumen_movimientos: [] }
  assert.equal(parseCashDetail(detail, session().id).caja.id, '5')
  assert.throws(() => parseCashDetail({ ...detail, caja: { ...detail.caja, id: '6' } }, session().id))
  assert.throws(() => parseCashDetail({ ...detail, resumen_movimientos: [1, 1].map(() => ({ tipo: 'ENTRADA', _sum: { monto: '1' } })) }, session().id))
  assert.equal(parseCashMovement(movement(), session().id).monto, '25.10')
  assert.throws(() => parseCashMovement(movement(), '9'))
  assert.throws(() => parseCashMovement({ ...movement(), monto: '0' }, session().id))
})
test('caja: paginación estricta y sin duplicados', () => {
  const data = { items: [session()], total: 1, page: 1, pageSize: 20 }
  assert.equal(parseCashPage({ ok: true, data }, parseCashSession, 1).total, 1)
  for (const patch of [{ page: 2 }, { total: 0 }, { pageSize: 0 }, { total: 2, items: [session(), session()] }]) assert.throws(() => parseCashPage({ ok: true, data: { ...data, ...patch } }, parseCashSession, 1))
})
test('caja: protección persistente aislada por usuario, sin aceptar datos dañados', () => {
  let raw = null
  const storage = { getItem: () => raw, setItem: (_key, value) => { raw = value }, removeItem: () => { raw = null } }
  assert.equal(readCashAttempt(storage), null)
  saveCashAttempt(storage, openAttempt()); assert.deepEqual(readCashAttempt(storage), openAttempt())
  saveCashAttempt(storage, moveAttempt()); assert.deepEqual(readCashAttempt(storage), moveAttempt())
  for (const value of ['{}','null','{','[]',JSON.stringify({ ...openAttempt(), companyId: '0' }),JSON.stringify({ ...openAttempt(), action: { ...openAttempt().action, previousMaxId: 'NaN' } })]) { raw = value; assert.equal(readCashAttempt(storage), 'unreadable') }
  assert.equal(readCashAttempt({ getItem: () => { throw new Error('storage bloqueado') } }), 'unreadable')
  clearCashAttempt(storage); assert.equal(readCashAttempt(storage), null)
})
test('caja: recuperación de apertura exige un registro nuevo, propietario, caja, importe y notas', () => {
  assert.equal(matchesCashAttempt(openAttempt(), session()), true)
  for (const patch of [{ id: '9007199254740992' }, { usuario_apertura_id: '9' }, { caja_id: '6' }, { monto_apertura: '501' }, { notas: 'otra' }]) assert.equal(matchesCashAttempt(openAttempt(), { ...session(), ...patch }), false)
})
test('caja: recuperación de movimiento exige coincidencia completa, no solo referencia', () => {
  assert.equal(matchesCashAttempt(moveAttempt(), movement()), true)
  for (const patch of [{ sesion_caja_id: '9' }, { usuario_id: '9' }, { tipo: 'SALIDA' }, { concepto: 'otro' }, { monto: '25.11' }, { referencia: 'UNICA-1' }]) assert.equal(matchesCashAttempt(moveAttempt(), { ...movement(), ...patch }), false)
})
test('caja: recuperación de cierre exige sesión, propietario de cierre y conteo correctos', () => {
  const attempt = { companyId: '1', userId: '3', action: { kind: 'close', cashId: '5', sessionId: session().id, body: { monto_cierre: '490.00', notas: 'Arqueo' } } }
  const closed = { ...session(), estado: 'CERRADA', usuario_cierre_id: '3', monto_cierre: '490', notas: 'Arqueo' }
  assert.equal(matchesCashAttempt(attempt, closed), true)
  for (const patch of [{ estado: 'ABIERTA' }, { id: '9' }, { usuario_cierre_id: '9' }, { monto_cierre: '500' }, { notas: 'otra' }]) assert.equal(matchesCashAttempt(attempt, { ...closed, ...patch }), false)
})
test('caja: conciliación recorre páginas y detecta historiales cambiantes o incompletos', async () => {
  const calls = []
  const rows = await allCashRows(async page => { calls.push(page); return { items: [{ id: String(page) }], total: 2, page, size: 1 } })
  assert.deepEqual(calls, [1, 2]); assert.equal(rows.length, 2)
  await assert.rejects(allCashRows(async page => ({ items: [{ id: '1' }], total: page === 1 ? 2 : 3, page, size: 1 })))
  await assert.rejects(allCashRows(async page => ({ items: [{ id: '1' }], total: 2, page, size: 1 })))
  await assert.rejects(allCashRows(async page => ({ items: [], total: 1, page, size: 20 })))
  assert.equal(latestCashSessionId([session(), { ...session(), id: '9007199254740994' }]), '9007199254740994')
})
test('simulador caja: apertura, entrada, retiro, cierre y arqueo con faltante conservan el historial', () => {
  const state = createCashFixtureState(), run = (method, path, input) => state.handle(method, url(path), 'normal', input)
  const opened = run('POST', '/cash/5/sessions', opening); assert.equal(opened.status, 201)
  const id = opened.body.data.id, path = '/cash/sessions/' + id
  assert.equal(run('POST', '/cash/5/sessions', opening).status, 409)
  const entry = { tipo: 'ENTRADA', concepto: 'Fondo adicional', monto: '0.20', referencia: 'QA-ENTRADA' }
  assert.equal(run('POST', path + '/movements', entry).status, 201)
  assert.equal(run('POST', path + '/movements', entry).status, 409)
  assert.equal(run('POST', path + '/movements', { ...entry, tipo: 'SALIDA', monto: '0.10', referencia: 'QA-SALIDA' }).status, 201)
  assert.equal(run('GET', path).body.data.monto_esperado_actual, '100.20')
  assert.equal(run('POST', path + '/movements', { ...entry, tipo: 'SALIDA', monto: '101', referencia: 'EXCESO' }).status, 409)
  const closed = run('POST', path + '/close', { monto_cierre: '100.00', notas: 'Conteo físico' })
  assert.equal(closed.status, 200); assert.equal(closed.body.data.diferencia, '-0.20')
  assert.equal(run('GET', '/cash/5/sessions/current').body.data, null)
  assert.equal(run('GET', path + '/movements').body.data.total, 2)
  assert.equal(run('POST', path + '/close', { monto_cierre: '100.00' }).status, 409)
  assert.equal(run('POST', path + '/movements', { ...entry, referencia: 'CERRADA' }).status, 409)
})
test('simulador caja: respuesta 503 posterior al registro se recupera con GET sin repetir POST', () => {
  for (const kind of ['open','move','close']) {
    const state = createCashFixtureState(), scenario = 'fault-' + kind
    const run = (method, path, input) => state.handle(method, url(path), scenario, input)
    let id, result
    if (kind === 'open') { result = run('POST','/cash/5/sessions', opening); id = run('GET','/cash/5/sessions/current').body.data.id }
    else {
      id = run('GET','/cash/5/sessions/current').body.data.id
      result = run('POST', '/cash/sessions/' + id + (kind === 'move' ? '/movements' : '/close'), kind === 'move' ? moveAttempt().action.body : { monto_cierre: '490', notas: null })
    }
    assert.equal(result.status, 503)
    const data = run('GET', kind === 'move' ? '/cash/sessions/' + id + '/movements' : '/cash/5/sessions').body.data
    assert.equal(data.total, 1)
    assert.equal(state.summary().requests.filter(row => row.method === 'POST').length, 1)
  }
})
test('simulador caja: permisos, sesión ajena y caja inactiva impiden cambios', () => {
  const state = createCashFixtureState()
  for (const scenario of ['other-owner','inactive','read-only']) {
    const current = state.handle('GET',url('/cash/5/sessions/current'),scenario).body.data
    const result = state.handle('POST',url('/cash/sessions/' + current.id + '/movements'),scenario, moveAttempt().action.body)
    assert.ok([403,409].includes(result.status))
    assert.equal(state.summary().scenarios.find(row => row.name === scenario).movements.length, 0)
  }
  assert.equal(state.handle('GET',url('/cash'),'no-permission').status, 403)
})
