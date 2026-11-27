// Oráculo aislado con aritmética BigInt. No importa el backend, Prisma ni .env.
const success = (data, status = 200) => ({ status, body: { ok: true, data: structuredClone(data) } })
const failure = (status, message) => ({ status, body: { ok: false, message } })
function cents(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) throw new Error('Importe inválido')
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
}
function decimal(value) { const absolute = value < 0n ? -value : value; return (value < 0n ? '-' : '') + absolute / 100n + '.' + String(absolute % 100n).padStart(2, '0') }
const timestamp = () => new Date().toISOString()
export const cashFixtureRegister = { id: '5', sucursal_id: '2', codigo: 'CAJA-QA', nombre: 'Caja de prueba aislada', activo: true }
export function createCashFixtureState() {
  const scenarios = new Map(), requests = []
  let nextSession = 9007199254740993n, nextMovement = 9007199254741000n
  function newSession(amount = '0.00', notes = null, owner = '3') {
    return { id: String(nextSession++), caja_id: '5', usuario_apertura_id: owner, usuario_cierre_id: null,
      fecha_apertura: timestamp(), fecha_cierre: null, monto_apertura: amount, monto_esperado: null, monto_cierre: null,
      diferencia: null, estado: 'ABIERTA', notas: notes }
  }
  function stateFor(scenario) {
    if (!scenarios.has(scenario)) {
      const sessions = [], movements = []
      if (scenario !== 'normal' && scenario !== 'fault-open' && scenario !== 'reject-open') sessions.push(newSession('500.00', null, scenario === 'other-owner' ? '9' : '3'))
      if (scenario === 'paged') {
        for (let index = 0; index < 22; index++) movements.push({ id: String(nextMovement++), sesion_caja_id: sessions[0].id, usuario_id: '3', tipo: 'ENTRADA', concepto: 'Entrada anterior ' + index, monto: '1.00', referencia: 'ANTERIOR:' + index, fecha: timestamp() })
      }
      scenarios.set(scenario, { sessions, movements, faults: new Set() })
    }
    return scenarios.get(scenario)
  }
  function balance(state, session) {
    return state.movements.filter(row => row.sesion_caja_id === session.id).reduce((sum, row) => sum + (row.tipo === 'ENTRADA' ? 1n : -1n) * cents(row.monto), cents(session.monto_apertura))
  }
  function page(rows, url) {
    const current = Number(url.searchParams.get('page') || 1), size = Number(url.searchParams.get('pageSize') || 20)
    return success({ items: [...rows].reverse().slice((current - 1) * size, current * size), total: rows.length, page: current, pageSize: size })
  }
  function fault(state, kind, data, status = 200) {
    if (!state.faults.has(kind)) { state.faults.add(kind); return failure(503, 'Respuesta interrumpida después del registro de prueba.') }
    return success(data, status)
  }
  function handle(method, url, scenario = 'normal', input = null) {
    const endpoint = url.pathname.replace(/^\/api\/v1/, '')
    if (!endpoint.startsWith('/cash')) return null
    requests.push({ method, endpoint, scenario })
    if (scenario === 'no-permission' || method !== 'GET' && scenario === 'read-only') return failure(403, 'Sin permiso de caja.')
    const state = stateFor(scenario), register = { ...cashFixtureRegister, activo: scenario !== 'inactive' }
    const current = state.sessions.find(row => row.estado === 'ABIERTA')
    if (method === 'GET' && endpoint === '/cash') return page([register], url)
    if (method === 'GET' && endpoint === '/cash/5/sessions/current') return success(current ?? null)
    if (method === 'GET' && endpoint === '/cash/5/sessions') {
      if (scenario === 'malformed') return success({ items: [{ id: '1' }], total: 1, page: 1, pageSize: 20 })
      return page(state.sessions, url)
    }
    if (method === 'POST' && endpoint === '/cash/5/sessions') {
      if (current) return failure(409, 'Ya existe una sesión abierta.')
      if (scenario === 'reject-open') return failure(422, 'Apertura rechazada por la prueba.')
      try {
        const amount = decimal(cents(input?.monto_apertura))
        if (!register.activo || input.notas !== null && (typeof input.notas !== 'string' || input.notas.length > 1500)) return failure(400, 'Apertura inválida.')
        const row = newSession(amount, input.notas); state.sessions.push(row)
        return scenario === 'fault-open' ? fault(state, 'open', row, 201) : success(row, 201)
      } catch { return failure(400, 'Importe inválido.') }
    }
    const match = /^\/cash\/sessions\/(\d+)(?:\/(movements|close))?$/.exec(endpoint)
    if (!match) return failure(404, 'Ruta de caja inexistente en el simulador.')
    const session = state.sessions.find(row => row.id === match[1])
    if (!session) return failure(404, 'Sesión inexistente.')
    if (method === 'GET' && !match[2]) {
      const groups = ['ENTRADA', 'SALIDA'].map(tipo => ({ tipo, _sum: { monto: decimal(state.movements.filter(row => row.sesion_caja_id === session.id && row.tipo === tipo).reduce((sum, row) => sum + cents(row.monto), 0n)) } }))
      return success({ ...session, caja: { id: '5', sucursal_id: '2', codigo: register.codigo, activo: register.activo }, monto_esperado_actual: decimal(balance(state, session)), resumen_movimientos: groups })
    }
    if (method === 'GET' && match[2] === 'movements') return page(state.movements.filter(row => row.sesion_caja_id === session.id), url)
    if (method !== 'POST') return failure(404, 'Ruta desconocida.')
    if (!register.activo || session.estado !== 'ABIERTA' || session.usuario_apertura_id !== '3') return failure(409, 'Se requiere sesión propia abierta y caja activa.')
    if (match[2] === 'movements') {
      try {
        const amount = cents(input?.monto), reference = 'MANUAL:' + input?.referencia
        if (amount <= 0n || !['ENTRADA','SALIDA'].includes(input.tipo) || typeof input.concepto !== 'string' || input.concepto.trim().length < 3 || input.concepto.length > 180 || typeof input.referencia !== 'string' || input.referencia.length < 3 || input.referencia.length > 105) return failure(400, 'Movimiento inválido.')
        if (state.movements.some(row => row.sesion_caja_id === session.id && row.referencia === reference)) return failure(409, 'Referencia duplicada.')
        if (input.tipo === 'SALIDA' && amount > balance(state, session)) return failure(409, 'Efectivo insuficiente.')
        const row = { id: String(nextMovement++), sesion_caja_id: session.id, usuario_id: '3', tipo: input.tipo, concepto: input.concepto, monto: decimal(amount), referencia: reference, fecha: timestamp() }
        state.movements.push(row)
        return scenario === 'fault-move' ? fault(state, 'move', row, 201) : success(row, 201)
      } catch { return failure(400, 'Importe inválido.') }
    }
    if (match[2] === 'close') {
      try {
        const counted = cents(input?.monto_cierre), expected = balance(state, session)
        Object.assign(session, { estado: 'CERRADA', fecha_cierre: timestamp(), usuario_cierre_id: '3', monto_cierre: decimal(counted), monto_esperado: decimal(expected), diferencia: decimal(counted - expected), notas: input.notas ?? session.notas })
        return scenario === 'fault-close' ? fault(state, 'close', session) : success(session)
      } catch { return failure(400, 'Conteo inválido.') }
    }
    return failure(404, 'Ruta desconocida.')
  }
  return { handle, summary: () => ({ scenarios: [...scenarios].map(([name, state]) => ({ name, sessions: structuredClone(state.sessions), movements: structuredClone(state.movements) })), requests }) }
}
