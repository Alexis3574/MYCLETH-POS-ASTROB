import { createSaleActionFixture } from './sale-actions-fixture.mjs'
// Datos y operaciones exclusivamente en memoria para comprobar el frontend.
// Este modelo de prueba no sustituye las reglas transaccionales del backend.
export const fullPermissions = ['VENTAS.VER', 'VENTAS.CREAR', 'VENTAS.DEVOLVER', 'VENTAS.CANCELAR', 'PRODUCTOS.VER', 'INVENTARIO.VER', 'CLIENTES.VER', 'CAJAS.VER']
export function fixtureUser(scenario = 'normal') {
  const granted = scenario === 'read-only' ? fullPermissions.filter(code => !['VENTAS.DEVOLVER','VENTAS.CANCELAR'].includes(code)) : scenario === 'no-permission' ? [] : scenario === 'cash-only' ? ['CAJAS.VER'] :
    scenario === 'no-customers' ? fullPermissions.filter((code) => code !== 'CLIENTES.VER') :
      scenario === 'no-inventory' ? fullPermissions.filter((code) => code !== 'INVENTARIO.VER') : fullPermissions
  return { id: '3', empresa: { id: '1', nombre: 'Empresa simulada' }, username: 'prueba', nombre: 'Operador de prueba', apellido: null,
    email: null, telefono: null, activo: true, bloqueado: false, ultimo_acceso: null, roles: [],
    permisos: granted.map((codigo, index) => ({ id: String(index + 1), codigo, modulo: codigo.split('.')[0], descripcion: null })) }
}
const baseProduct = { id: '9007199254740993', empresa_id: '1', sku: 'P-001', codigo_barras: '750001', nombre: 'Artículo de prueba',
  tipo: 'PRODUCTO', activo: true, controla_inventario: true, precio_venta: '100.00',
  unidad_medida: { nombre: 'Pieza', codigo: 'PZA', activo: true, permite_decimales: false },
  impuestos: [{ id: '1', tasa: '16.0000', activo: true }] }
const products = [baseProduct, ...Array.from({ length: 20 }, (_, index) => ({ ...baseProduct,
  id: String(index + 11), sku: 'P-' + String(index + 2).padStart(3, '0'), codigo_barras: '7500' + String(index + 2).padStart(2, '0'), nombre: 'Producto ' + (index + 2) })),
{ ...baseProduct, id: '40', sku: 'SERV-001', codigo_barras: null, nombre: 'Servicio por hora', tipo: 'SERVICIO', controla_inventario: false, precio_venta: '50.00',
  unidad_medida: { nombre: 'Hora', codigo: 'H', activo: true, permite_decimales: true }, impuestos: [] },
{ ...baseProduct, id: '41', sku: 'INACTIVO', nombre: 'Producto inactivo', activo: false }]
const customers = [{ id: '8', codigo: 'C-001', nombre: 'Cliente de prueba', rfc: null, email: 'cliente@example.test', telefono: null, activo: true, limite_credito: '1000.00', dias_credito: 30 },
  { id: '9', codigo: 'C-002', nombre: 'Cliente inactivo', rfc: null, email: null, telefono: null, activo: false, limite_credito: '0.00', dias_credito: 0 }]
const warehouses = [1, 2].map((id) => ({ id: String(id), codigo: 'A-' + id, nombre: 'Almacén ' + id, activo: true,
  sucursal: { id: String(id + 1), empresa_id: '1', codigo: 'S-' + id, nombre: 'Sucursal ' + id, activo: true } }))
const methods = [{ id: '1', codigo: 'TRANSFERENCIA', nombre: 'Transferencia', es_efectivo: false, activo: true },
  { id: '2', codigo: 'EFECTIVO', nombre: 'Efectivo', es_efectivo: true, activo: true },
  { id: '3', codigo: 'CREDITO', nombre: 'Crédito', es_efectivo: false, activo: true }]
const registers = [2, 3].map((branch, i) => ({ id: String(i + 5), sucursal_id: String(branch), codigo: 'CAJA-' + (i + 1), nombre: 'Caja ' + (i + 1) + ' de prueba', activo: true }))
const page = (rows, url, nested = false, sales = false) => {
  const current = Number(url.searchParams.get('page') || 1)
  const size = Number(url.searchParams.get(nested ? 'pageSize' : 'limit') || 20)
  const items = rows.slice((current - 1) * size, current * size)
  return nested ? { ok: true, data: { items, total: rows.length, page: current, pageSize: size } } :
    { ok: true, data: items, pagination: { page: current, limit: size, total: rows.length, [sales ? 'totalPages' : 'total_pages']: Math.ceil(rows.length / size) } }
}
const activeFilter = (rows, url) => rows.filter((item) => !url.searchParams.has('activo') || item.activo === (url.searchParams.get('activo') === 'true'))
const match = (values, query) => !query || values.some((value) => String(value ?? '').toLowerCase().includes(query.toLowerCase()))
const ok = (body) => ({ status: 200, body })
const failure = (status, message) => ({ status, body: { ok: false, message } })
// Aritmética decimal independiente del estimador de la interfaz para el oráculo de prueba.
function units(value, scale) {
  const text = String(value)
  if (!new RegExp('^\\d+(?:\\.\\d{1,' + scale + '})?$').test(text)) throw new Error('Decimal de prueba no válido.')
  const [whole, fraction = ''] = text.split('.')
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0'))
}
const divideRound = (value, divisor) => (value + divisor / 2n) / divisor
const amount = (cents) => Number(cents) / 100

export function createFixtureState(inventory = null) {
  const sales = new Map(), consumed = new Map(), operations = new Map()
  const folios = new Map()
  let nextSale = 99n
  const actions = createSaleActionFixture({ sales, consumed, registers, session, inventory })
  function available(productId, warehouseId) { return inventory ? inventory.available(productId,warehouseId) : (warehouseId === '2' ? 40000n : 100000n) - (consumed.get(warehouseId + ':' + productId) ?? 0n) }
  function session(registerId, scenario) {
    if (scenario === 'cash-none') return null
    return { id: String(Number(registerId) + 1), caja_id: registerId, usuario_apertura_id: scenario === 'cash-other' ? '9' : '3',
      estado: scenario === 'cash-closed' ? 'CERRADA' : 'ABIERTA', fecha_cierre: scenario === 'cash-closed' ? '2026-11-19T12:00:00Z' : null, monto_apertura: '500.00' }
  }
  function createSale(input, scenario) {
    const hash = JSON.stringify(input)
    const operationKey = input?.clave_idempotencia
    if (operationKey && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationKey)) return failure(400, 'Clave de intento no válida.')
    if (operations.has(operationKey)) {
      const previous = operations.get(operationKey)
      return previous.hash === hash ? ok({ ok: true, data: previous.sale }) : failure(409, 'La clave ya pertenece a otra solicitud.')
    }
    const day=inventory?new Date().toISOString().slice(0,10).replaceAll('-',''):'20261119'
    const folioScope = input?.empresa_id + ':' + input?.sucursal_id + ':' + day
    let nextFolio = folios.get(folioScope) ?? 1
    const automatic = input?.folio === undefined
    if (automatic) {
      if (!operationKey) return failure(400, 'Se requiere clave de idempotencia.')
      let folio
      do { folio = 'VTA-' + input.sucursal_id + '-' + day + '-' + String(nextFolio++).padStart(6, '0') }
      while ([...sales.values()].some(sale => sale.sucursal.id === input.sucursal_id && sale.folio === folio))
      input = { ...input, folio }
    }
    const warehouse = warehouses.find((item) => item.id === input?.almacen_id && item.sucursal.id === input.sucursal_id)
    if (!warehouse || input.empresa_id !== '1') return failure(422, 'Almacén o empresa no disponible.')
    if (typeof input.folio !== 'string' || !input.folio.trim() || input.folio.length > 50) return failure(400, 'Folio no válido.')
    if ([...sales.values()].some((sale) => sale.sucursal.id === input.sucursal_id && sale.folio === input.folio)) return failure(409, 'El folio ya existe en esta sucursal.')
    if (input.folio === 'REJECT') return failure(422, 'Stock insuficiente para el producto.')
    const customer = input.cliente_id ? customers.find((item) => item.id === input.cliente_id && item.activo) : null
    if (input.cliente_id && !customer) return failure(422, 'Cliente no disponible.')
    if (!Array.isArray(input.detalles) || !input.detalles.length || !Array.isArray(input.pagos) || !input.pagos.length) return failure(400, 'Se requieren artículos y pagos.')
    const details = [], required = new Map()
    let subtotal = 0n, discount = 0n, tax = 0n, total = 0n
    try {
      for (const item of input.detalles) {
        const product = products.find((row) => row.id === item.producto_id && row.activo)
        if (!product) return failure(422, 'Producto no disponible.')
        const quantity = units(item.cantidad, 3), percentage = units(item.descuento_porcentaje, 4)
        if (quantity <= 0n || percentage > 1000000n || ((!product.unidad_medida.permite_decimales || product.controla_inventario) && quantity % 1000n)) return failure(422, 'Cantidad o descuento no válido.')
        const lineSubtotal = divideRound(units(product.precio_venta, 2) * quantity, 1000n)
        const lineDiscount = divideRound(lineSubtotal * percentage, 1000000n)
        const rates = product.impuestos.filter((item) => item.activo).reduce((value, item) => value + units(item.tasa, 4), 0n)
        const lineTax = divideRound((lineSubtotal - lineDiscount) * rates, 1000000n)
        const lineTotal = lineSubtotal - lineDiscount + lineTax
        details.push({ id: String(details.length + 1), producto_id: product.id, descripcion: product.nombre,
          producto: product, cantidad: Number(quantity) / 1000, precio_unitario: Number(product.precio_venta), descuento_porcentaje: Number(item.descuento_porcentaje), tasa_impuesto: Number(rates) / 10000,
          subtotal_linea: amount(lineSubtotal), descuento_importe: amount(lineDiscount), impuesto_importe: amount(lineTax), total_linea: amount(lineTotal) })
        subtotal += lineSubtotal; discount += lineDiscount; tax += lineTax; total += lineTotal
        if (product.controla_inventario) required.set(product.id, (required.get(product.id) ?? 0n) + quantity)
      }
      for (const [id, quantity] of required) if (quantity > available(id, warehouse.id)) return failure(422, 'Stock insuficiente para el producto.')
      const payments = [], date = inventory?new Date().toISOString():'2026-11-19T12:00:00.000Z'
      let paid = 0n, credit = false, hasCash = false
      for (const payment of input.pagos) {
        const method = methods.find((item) => item.id === payment.metodo_pago_id && item.activo)
        if (!method) return failure(422, 'Método de pago no disponible.')
        const cents = units(payment.monto, 2)
        if (cents <= 0n) return failure(400, 'El pago debe ser positivo.')
        hasCash ||= method.es_efectivo; credit ||= method.codigo === 'CREDITO'; paid += cents
        payments.push({ id: String(payments.length + 1), monto: amount(cents), referencia: payment.referencia ?? null, fecha: date, metodo_pago: method })
      }
      if (credit && !customer) return failure(422, 'Una venta a crédito requiere cliente.')
      if (paid !== total) return failure(422, 'La suma de pagos no coincide con el total de la venta.')
      const register = registers.find((item) => item.sucursal_id === warehouse.sucursal.id)
      const current = session(register.id, scenario)
      if (hasCash && (!current || current.estado !== 'ABIERTA' || current.usuario_apertura_id !== '3' || input.sesion_caja_id !== current.id)) return failure(422, 'La sesión de caja no está disponible para este usuario.')
      const sale = { id: String(nextSale++), folio: input.folio, fecha: date, estado: 'COMPLETADA', condicion_pago: credit ? 'CREDITO' : 'CONTADO',
        subtotal: amount(subtotal), descuento: amount(discount), impuesto: amount(tax), total: amount(total),
        sucursal: warehouse.sucursal, almacen: warehouse, empresa: { id: '1', nombre: 'Empresa simulada' }, cliente: customer,
        usuario: { id: '3', username: 'prueba', nombre: 'Operador de prueba', apellido: null }, observaciones: input.observaciones,
        detalles: details, pagos: payments, devoluciones: { tiene_devoluciones: false, total_devoluciones: 0, total_devuelto: 0 },
        sesion_caja: hasCash ? { ...current, fecha_apertura: date, caja: register } : null }
      // Solo se modifica el modelo en memoria después de todas las validaciones.
      inventory?.applySale(sale,'create')
      sales.set(sale.id, sale)
      if (automatic) folios.set(folioScope, nextFolio)
      if (operationKey) operations.set(operationKey, { hash, sale })
      for (const [id, quantity] of required) consumed.set(warehouse.id + ':' + id, (consumed.get(warehouse.id + ':' + id) ?? 0n) + quantity)
      if (input.folio === 'UNCERTAIN' || scenario === 'uncertain') return failure(503, 'Respuesta interrumpida; el simulador sí registró la venta. Revisa el folio.')
      if (input.folio === 'NETWORK-LOST' || scenario === 'network-lost') return { status: 0, drop: true }
      if (input.folio === 'MALFORMED') return { status: 201, body: { ok: true, data: { id: sale.id } } }
      return { status: 201, delay: 500, body: { ok: true, data: sale } }
    } catch { return failure(400, 'Datos numéricos no válidos.') }
  }
  function financial(sale) {
    const byMethod = methods.map((method) => {
      const original = sale.pagos.filter((item) => item.metodo_pago.id === method.id).reduce((sum, item) => sum + item.monto, 0)
      return { metodo_pago: method, monto_original: original, monto_devuelto: actions.history(sale.id).flatMap(record => record.reembolsos).filter(refund => refund.metodo_pago.id === method.id).reduce((sum, row) => sum + row.monto, 0), monto_revertido_cancelacion: sale.estado === 'CANCELADA' ? original : 0, monto_neto: sale.estado === 'CANCELADA' ? 0 : original - actions.history(sale.id).flatMap(record => record.reembolsos).filter(refund => refund.metodo_pago.id === method.id).reduce((sum, row) => sum + row.monto, 0) }
    }).filter((item) => item.monto_original > 0)
    const cash = byMethod.filter((item) => item.metodo_pago.es_efectivo).reduce((sum, item) => sum + item.monto_original, 0)
    const cashRefunded = byMethod.filter(item => item.metodo_pago.es_efectivo).reduce((sum, item) => sum + item.monto_devuelto, 0)
    const credit = byMethod.find((item) => item.metodo_pago.codigo === 'CREDITO')
    return { venta: sale, resumen: { total_venta: sale.total, total_pagos_registrados: sale.total, total_devuelto: sale.devoluciones.total_devuelto, total_revertido_cancelacion: sale.estado === 'CANCELADA' ? sale.total : 0,
      total_neto_venta: sale.estado === 'CANCELADA' ? 0 : sale.total - sale.devoluciones.total_devuelto, total_neto_pagos: sale.estado === 'CANCELADA' ? 0 : sale.total - sale.devoluciones.total_devuelto, estado_financiero: sale.estado === 'CANCELADA' ? 'CANCELADA' : sale.devoluciones.total_devuelto >= sale.total ? 'DEVUELTA_TOTAL' : sale.devoluciones.total_devuelto > 0 ? 'DEVUELTA_PARCIAL' : 'PAGADA' }, metodos_pago: byMethod,
    efectivo: { ingresado: cash, devuelto: cashRefunded, revertido_cancelacion: sale.estado === 'CANCELADA' ? cash : 0, neto: sale.estado === 'CANCELADA' ? 0 : cash - cashRefunded }, credito: credit ? { monto_original: credit.monto_original,
      monto_devuelto: credit.monto_devuelto, monto_neto_post_devoluciones: credit.monto_neto, cliente: sale.cliente, cuentas_por_cobrar_integrado: false } : null }
  }
  return {
    handle(method, url, scenario = 'normal', input = null) {
      const path = url.pathname.replace('/api/v1', '')
      if (path === '/auth/me') return ok({ ok: true, data: fixtureUser(scenario) })
      if (scenario === 'expired') return failure(401, 'Sesión expirada.')
      const needed = method === 'POST' && /\/returns$/.test(path) ? 'VENTAS.DEVOLVER' : method === 'PATCH' && /\/cancel$/.test(path) ? 'VENTAS.CANCELAR' : path.startsWith('/products') ? 'PRODUCTOS.VER' : path.startsWith('/customers') ? 'CLIENTES.VER' :
        path.startsWith('/inventory') ? 'INVENTARIO.VER' : path.startsWith('/cash') ? 'CAJAS.VER' : path.startsWith('/sales') ? method === 'POST' || path.startsWith('/sales/operations/') ? 'VENTAS.CREAR' : 'VENTAS.VER' : null
      if (scenario === 'forbidden' || needed && !fixtureUser(scenario).permisos.some((item) => item.codigo === needed)) return failure(403, 'Acceso denegado.')
      const action = actions.handle(method, path, input, scenario)
      if (action) return action
      if (method === 'POST' && path === '/sales') return createSale(input, scenario)
      if (method !== 'GET') return failure(405, 'Operación no prevista en el simulador.')
      if (path === '/products') {
        if (scenario === 'malformed') return ok({ ok: true, data: [{ id: '1' }], pagination: { page: 1, limit: 20, total: 1 } })
        const search = url.searchParams.get('search')
        const rows = activeFilter(products, url).filter((item) => match([item.nombre, item.sku, item.codigo_barras], search))
        return { ...ok(page(scenario === 'empty' ? [] : rows, url)), delay: search === 'slow' ? 1000 : 0 }
      }
      if (path === '/customers') return ok(page(scenario === 'empty' ? [] : activeFilter(customers, url).filter((item) => match([item.nombre, item.codigo, item.rfc, item.email, item.telefono], url.searchParams.get('q'))), url, true))
      if (path === '/inventory/warehouses') return ok(page(scenario === 'empty' ? [] : warehouses, url))
      if (path === '/inventory/stock') {
        const warehouseId = url.searchParams.get('almacen_id')
        if (!warehouses.some((item) => item.id === warehouseId)) return failure(404, 'Almacén no disponible.')
        const rows = activeFilter(products, url).filter((item) => item.controla_inventario && (!url.searchParams.has('producto_id') || item.id === url.searchParams.get('producto_id')) &&
          match([item.nombre, item.sku, item.codigo_barras], url.searchParams.get('search'))).map((item) => {
          const availableUnits = available(item.id, warehouseId)
          return { producto: item, almacen_id: warehouseId, cantidad: (Number(availableUnits) / 1000 + 2).toFixed(3), reservado: '2.000', disponible: (Number(availableUnits) / 1000).toFixed(3), existencia_registrada: true, bajo_minimo: availableUnits < 1000n }
        })
        return ok(page(rows, url))
      }
      if (path === '/payment-methods') return ok(page(methods, url, true))
      if (path === '/cash') return ok(page(registers.filter((item) => !url.searchParams.has('sucursal_id') || item.sucursal_id === url.searchParams.get('sucursal_id')), url, true))
      const cashMatch = /^\/cash\/(\d+)\/sessions\/current$/.exec(path)
      if (cashMatch) return registers.some((item) => item.id === cashMatch[1]) ? ok({ ok: true, data: session(cashMatch[1], scenario) }) : failure(404, 'Caja no disponible.')
      if (path.startsWith('/sales/operations/')) {
        const operation = operations.get(decodeURIComponent(path.slice('/sales/operations/'.length)))
        return operation ? ok({ ok: true, data: operation.sale }) : failure(404, 'No se encontró resultado confirmado; no repitas un intento en curso.')
      }
      if (path === '/sales') {
        const rows = [...sales.values()].filter((sale) => match([sale.folio], url.searchParams.get('folio')) &&
          (!url.searchParams.get('cliente_id') || sale.cliente?.id === url.searchParams.get('cliente_id')) &&
          (!url.searchParams.get('estado') || sale.estado === url.searchParams.get('estado')) &&
          (!url.searchParams.get('condicion_pago') || sale.condicion_pago === url.searchParams.get('condicion_pago')) &&
          (!url.searchParams.get('fecha_desde') || sale.fecha.slice(0, 10) >= url.searchParams.get('fecha_desde')) &&
          (!url.searchParams.get('fecha_hasta') || sale.fecha.slice(0, 10) <= url.searchParams.get('fecha_hasta'))).reverse()
        return ok(page(rows, url, false, true))
      }
      const saleMatch = /^\/sales\/(\d+)(\/financial-summary)?$/.exec(path)
      if (saleMatch) {
        const sale = sales.get(saleMatch[1])
        if (!sale) return failure(404, 'Venta no encontrada.')
        if (saleMatch[2] && scenario === 'financial-error') return failure(500, 'Resumen financiero no disponible.')
        return ok({ ok: true, data: saleMatch[2] ? financial(sale) : sale })
      }
      return failure(404, 'Ruta sin simulación: ' + path)
    },
    summary() { return { sales: sales.size, total: [...sales.values()].reduce((sum, item) => sum + item.total, 0) } },
  }
}
