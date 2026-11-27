import test from 'node:test'
import assert from 'node:assert/strict'
import { createPosDraftStore } from '../src/features/pos/pos.draft.ts'
import { readPendingSale } from '../src/features/pos/submission.guard.ts'

test('el borrador conserva folio, artículos y pagos cuando la pantalla vuelve a leer la misma sesión', () => {
  const store = createPosDraftStore()
  store.update('empresa-usuario-sesion', { folio: 'BORRADOR-1', lines: [{ product: { id: '1' }, quantity: '2', discount: '10' }], payments: [{ key: 1, methodId: '2', amount: '208.80', reference: '' }] })
  assert.equal(store.get('empresa-usuario-sesion').folio, 'BORRADOR-1')
  store.update('empresa-usuario-sesion', { notes: 'Se conserva al navegar' })
  assert.equal(store.get('empresa-usuario-sesion').lines[0].quantity, '2')
  assert.equal(store.get('empresa-usuario-sesion').payments[0].amount, '208.80')
})
test('el borrador no se expone a otra identidad y puede descartarse expresamente', () => {
  const store = createPosDraftStore()
  store.update('sesion-A', { folio: 'PRIVADO', customer: { id: '1', nombre: 'Cliente de prueba' } })
  assert.equal(store.get('sesion-B').folio, '')
  assert.equal(store.get('sesion-B').customer, null)
  store.clear()
  assert.equal(store.get('sesion-A').folio, '')
  assert.equal(store.get('sesion-A').customer, null)
})
test('registros de intento incompletos o dañados mantienen la protección en lugar de permitir reenvío', () => {
  for (const value of ['{}', '[]', 'null', '123', '"texto"', '{invalid', '{"companyId":"1","branchId":"2","folio":""}']) {
    assert.ok(readPendingSale({ getItem: () => value }), value)
  }
  assert.equal(readPendingSale({ getItem: () => null }), null)
})
