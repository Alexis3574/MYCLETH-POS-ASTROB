import test from 'node:test'
import assert from 'node:assert/strict'
import { cashChange, remainingPayment, toCents } from '../src/features/pos/payment.balance.ts'
import { buildSaleInput } from '../src/features/pos/pos.logic.ts'
import { readPendingSale, savePendingSale } from '../src/features/pos/submission.guard.ts'

test('importe pendiente completa pagos combinados sin incluir dos veces la línea editada', () => {
  const payments = [{ key: 1, amount: '100.00' }, { key: 2, amount: '' }]
  assert.equal(remainingPayment(220.4, payments, 2), '120.40')
  assert.equal(remainingPayment(100, [{ key: 1, amount: '100' }]), null)
  assert.equal(remainingPayment(100, [{ key: 1, amount: '100.01' }]), null)
  assert.equal(remainingPayment(100, [{ key: 1, amount: '1e2' }]), null)
})
test('cambio decimal distingue recibido de aplicado y rechaza efectivo insuficiente', () => {
  assert.equal(cashChange('200', '120.40'), '79.60')
  assert.equal(cashChange('120.40', '120.40'), '0.00')
  for (const received of ['120.39', '-1', '1e3', '', '200.001']) assert.equal(cashChange(received, '120.40'), null)
  assert.equal(toCents('999999999999999999'), null)
})
test('captura automática omite folio e identidad del usuario y conserva clave del intento', () => {
  const operationKey = '11111111-1111-4111-8111-111111111111'
  const request = buildSaleInput({ companyId: '1', userId: '3', warehouse: { id: '1', activo: true, sucursal: { id: '2', activo: true, empresa_id: '1' } },
    customer: null, cash: null, folio: '', operationKey, notes: '', methods: [{ id: '1', activo: true, codigo: 'TRANSFERENCIA', es_efectivo: false }],
    payments: [{ key: 1, methodId: '1', amount: '116.00', reference: '' }], lines: [{ quantity: '1', discount: '0', product: {
      id: '4', empresa_id: '1', activo: true, nombre: 'Artículo', controla_inventario: true, precio_venta: '100.00', unidad_medida: { activo: true, permite_decimales: false }, impuestos: [{ activo: true, tasa: '16' }] } }] })
  assert.equal('folio' in request, false); assert.equal('usuario_id' in request, false); assert.equal(request.clave_idempotencia, operationKey)
  let raw = null
  savePendingSale({ setItem: (_key, value) => { raw = value } }, { companyId: '1', branchId: '2', folio: 'Automático', operationKey })
  assert.equal(readPendingSale({ getItem: () => raw }).operationKey, operationKey)
  assert.equal(readPendingSale({ getItem: () => raw.replace(operationKey, 'malformado') }).companyId, '')
})
