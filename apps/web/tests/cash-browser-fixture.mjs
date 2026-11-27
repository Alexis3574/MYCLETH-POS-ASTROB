import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fixtureUser, createFixtureState } from './pos-fixture-state.mjs'
import { createCashFixtureState } from './cash-fixture-state.mjs'

function cashUser(scenario) {
  const user = fixtureUser(scenario === 'no-permission' ? 'no-permission' : 'normal')
  if (scenario === 'read-only') user.permisos = user.permisos.filter(item => item.codigo === 'CAJAS.VER')
  else if (scenario !== 'no-permission') ['CAJAS.ABRIR','CAJAS.MOVER','CAJAS.CERRAR'].forEach((codigo, index) => user.permisos.push({ id: String(100 + index), codigo, modulo: 'CAJAS', descripcion: null }))
  return user
}
export async function startCashFixture(port = 5181) {
  const cash = createCashFixtureState(), base = createFixtureState(), requests = []
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, envDir: false,
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1') },
    plugins: [react(), {
      name: 'isolated-cash-fixture',
      transformIndexHtml(html, context) {
        const scenario = new URL(context.originalUrl || '/', 'http://fixture').searchParams.get('fixture') || 'normal'
        const user = cashUser(scenario)
        const auth = { accessToken: 'fixture-' + scenario, user, expiresAt: Date.now() + 3600000 }
        return [{ tag: 'script', injectTo: 'head-prepend', children: 'sessionStorage.setItem("posmycleth.auth.session.v1",' + JSON.stringify(JSON.stringify(auth)) + ')' }]
      },
      configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://fixture')
        if (req.method === 'GET' && url.pathname === '/__qa/cash') {
          const state = cash.summary()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ scenarios: state.scenarios.map(row => ({ name: row.name, sessions: row.sessions.length, movements: row.movements.length })), writes: requests.filter(row => row.method !== 'GET') }))
          return
        }
        if (!url.pathname.startsWith('/api/')) return next()
        const scenario = String(req.headers.authorization || '').replace('Bearer fixture-', '') || 'normal'
        try {
          const chunks = []; for await (const chunk of req) chunks.push(chunk)
          const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
          const result = url.pathname === '/api/v1/auth/me' ? { status: 200, body: { ok: true, data: cashUser(scenario) } }
            : cash.handle(req.method, url, scenario, input) ?? base.handle(req.method, url, 'normal', input)
          requests.push({ method: req.method, path: url.pathname, scenario, status: result.status })
          if (scenario === 'slow-preflight' && req.method === 'GET' && /^\/api\/v1\/cash\/sessions\/\d+$/.test(url.pathname) && requests.filter(row => row.scenario === scenario && row.path === url.pathname).length === 2) await new Promise(resolve => setTimeout(resolve, 1500))
          res.writeHead(result.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result.body))
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, message: 'Solicitud de simulación inválida.' }))
        }
      }) },
    }],
    server: { host: '127.0.0.1', port, strictPort: true },
  })
  await server.listen()
  return { server, url: 'http://127.0.0.1:' + server.httpServer.address().port, stats: () => ({ ...cash.summary(), requests }) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startCashFixture(Number(process.env.CASH_FIXTURE_PORT || 5181))
  process.stdout.write('Simulador de caja aislado: ' + fixture.url + '/cash\n')
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', async chunk => {
    if (chunk.trim() === 'stats') process.stdout.write(JSON.stringify(fixture.stats()) + '\n')
    if (chunk.trim() === 'stop') { await fixture.server.close(); process.exit(0) }
  })
}
