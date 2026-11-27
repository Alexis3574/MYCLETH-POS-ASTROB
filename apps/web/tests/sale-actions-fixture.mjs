// Modelo en memoria independiente del código de producción. No importa el backend.
const ok = data => ({ status: 200, body: { ok: true, data } })
const reject = (status, message) => ({ status, body: { ok: false, message } })
function decimal(value, scale) {
  const text = String(value)
  if (!new RegExp('^\\d+(?:\\.\\d{1,' + scale + '})?$').test(text)) throw new Error('Decimal inválido')
  const [whole, fraction = ''] = text.split('.')
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0'))
}
const cents = value => decimal(value, 2)
const money = value => Number(value) / 100
const ratio = (value, requested, original) => (value * requested + original / 2n) / original
export function createSaleActionFixture({ sales, consumed, registers, session, inventory = null }) {
  const returns = new Map()
  let nextReturn = 200
  const history = saleId => returns.get(saleId) ?? []
  function restore(sale, details, kind, documentId) {
    inventory?.applySale(sale,kind,details,documentId)
    for (const detail of details) {
      const original = sale.detalles.find(item => item.id === detail.venta_detalle_id)
      if (!original.producto.controla_inventario) continue
      const key = sale.almacen.id + ':' + original.producto_id
      consumed.set(key, (consumed.get(key) ?? 0n) - decimal(detail.cantidad, 3))
    }
  }
  return {
    history,
    handle(method, path, input, scenario) {
      const match = /^\/sales\/(\d+)\/(returns(?:\/(\d+))?|cancel)$/.exec(path)
      if (!match) return null
      const sale = sales.get(match[1])
      if (!sale) return reject(404, 'Venta no encontrada.')
      const previous = history(sale.id)
      if (method === 'GET' && match[2].startsWith('returns')) {
        if (scenario === 'returns-malformed') return ok({ venta: sale, total_devoluciones: 1, total_devuelto: 10, devoluciones: [{}] })
        if (match[3]) {
          const record = previous.find(item => item.id === match[3])
          return record ? ok({ venta: sale, devolucion: record }) : reject(404, 'Devolución no encontrada.')
        }
        return ok({ venta: sale, total_devoluciones: previous.length, total_devuelto: money(previous.reduce((sum, row) => sum + cents(row.total), 0n)), devoluciones: previous })
      }
      if (method === 'PATCH' && match[2] === 'cancel') {
        if (sale.estado !== 'COMPLETADA' || previous.length) return reject(409, 'No se puede cancelar una venta cancelada o con devoluciones.')
        if (sale.pagos.some(payment => payment.metodo_pago.es_efectivo)) {
          const current = sale.sesion_caja && session(sale.sesion_caja.caja.id, scenario)
          if (!current || current.estado !== 'ABIERTA') return reject(409, 'La sesión original de efectivo está cerrada.')
        }
        restore(sale, sale.detalles.map(item => ({ venta_detalle_id: item.id, cantidad: item.cantidad })),'cancel',sale.id)
        sale.estado = 'CANCELADA'
        if (scenario === 'cancel-uncertain') return reject(503, 'Cancelación registrada; respuesta perdida de prueba.')
        return ok({ id: sale.id, folio: sale.folio, estado: 'CANCELADA', unidades_reintegradas: 1 })
      }
      if (method !== 'POST' || match[2] !== 'returns') return reject(405, 'Operación no admitida por el simulador.')
      if (sale.estado !== 'COMPLETADA') return reject(409, 'La venta no admite devoluciones.')
      if (typeof input?.folio !== 'string' || !input.folio.trim() || input.folio.length > 50 || typeof input.motivo !== 'string' || input.motivo.trim().length < 3 || input.motivo.length > 250) return reject(400, 'Revisa folio y motivo.')
      if ([...returns.values()].flat().some(record => record.folio === input.folio)) return reject(409, 'El folio de devolución ya existe.')
      if (!input.detalles?.length || !input.reembolsos?.length || new Set(input.detalles.map(row => row.venta_detalle_id)).size !== input.detalles.length ||
        new Set(input.reembolsos.map(row => row.venta_pago_id)).size !== input.reembolsos.length) return reject(400, 'Se requieren artículos y reembolsos sin duplicados.')
      try {
        const details = []
        let total = 0n
        for (const requested of input.detalles) {
          const original = sale.detalles.find(item => item.id === requested.venta_detalle_id)
          if (!original) return reject(422, 'Artículo ajeno a la venta.')
          const quantity = decimal(requested.cantidad, 3), originalQuantity = decimal(original.cantidad, 3)
          const prior = previous.flatMap(record => record.detalles).filter(row => row.venta_detalle_id === original.id)
          const available = originalQuantity - prior.reduce((sum, row) => sum + decimal(row.cantidad, 3), 0n)
          if (quantity <= 0n || quantity > available || original.producto.controla_inventario && quantity % 1000n) return reject(409, 'Cantidad no devolvible.')
          const values = {}
          for (const key of ['subtotal_linea', 'descuento_importe', 'impuesto_importe', 'total_linea']) {
            const originalCents = cents(original[key]), returnedCents = prior.reduce((sum, row) => sum + cents(row[key]), 0n)
            values[key] = money(quantity === available ? originalCents - returnedCents : ratio(originalCents, quantity, originalQuantity))
          }
          total += cents(values.total_linea)
          details.push({ id: String(details.length + 1), venta_detalle_id: original.id, cantidad: Number(quantity) / 1000, ...values, producto: original.producto })
        }
        const refunds = []
        let refunded = 0n
        for (const requested of input.reembolsos) {
          const original = sale.pagos.find(item => item.id === requested.venta_pago_id)
          if (!original) return reject(422, 'Pago ajeno a la venta.')
          const value = cents(requested.monto)
          const prior = previous.flatMap(record => record.reembolsos).filter(row => row.venta_pago_id === original.id).reduce((sum, row) => sum + cents(row.monto), 0n)
          if (value <= 0n || value > cents(original.monto) - prior) return reject(409, 'Reembolso superior al disponible.')
          if (original.metodo_pago.es_efectivo) {
            const register = registers.find(row => row.sucursal_id === sale.sucursal.id)
            const current = register && session(register.id, scenario)
            if (!current || current.estado !== 'ABIERTA' || current.usuario_apertura_id !== '3' || input.sesion_caja_id !== current.id) return reject(422, 'Se requiere una sesión propia abierta.')
          }
          refunded += value
          refunds.push({ id: String(refunds.length + 1), venta_pago_id: original.id, monto: money(value), referencia: requested.referencia ?? null, metodo_pago: original.metodo_pago })
        }
        if (total <= 0n || total !== refunded) return reject(422, 'Los reembolsos deben cubrir el importe exacto.')
        const record = { id: String(nextReturn++), venta_id: sale.id, usuario_id: '3', folio: input.folio, motivo: input.motivo,
          fecha: inventory?new Date().toISOString():'2026-11-19T12:00:00Z', total: money(total), detalles: details, reembolsos: refunds }
        restore(sale, details,'return',record.id)
        returns.set(sale.id, [...previous, record])
        sale.devoluciones = { tiene_devoluciones: true, total_devoluciones: previous.length + 1, total_devuelto: money([...previous, record].reduce((sum, row) => sum + cents(row.total), 0n)) }
        if (input.folio.startsWith('UNCERTAIN')) return reject(503, 'Devolución registrada; respuesta perdida de prueba.')
        if (input.folio.startsWith('MALFORMED')) return { status: 201, body: { ok: true, data: { id: record.id } } }
        return { status: 201, body: { ok: true, data: record } }
      } catch { return reject(400, 'Decimal de devolución no válido.') }
    },
  }
}
