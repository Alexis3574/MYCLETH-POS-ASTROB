// Servidor aislado: no importa apps/api, no lee .env y no configura proxy.
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createFixtureState, fixtureUser } from './pos-fixture-state.mjs'

export async function startPosFixture(port = 5174) {
  const state = createFixtureState(), requests = []
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, envDir: false,
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1') },
    plugins: [react(), {
      name: 'isolated-pos-fixture',
      transformIndexHtml(html, context) {
        const scenario = new URL(context.originalUrl || '/', 'http://fixture').searchParams.get('fixture') || 'normal'
        const auth = { accessToken: 'fixture-' + scenario, user: fixtureUser(scenario), expiresAt: Date.now() + 3600000 }
        return [{ tag: 'script', injectTo: 'head-prepend', children: 'sessionStorage.setItem("posmycleth.auth.session.v1",' + JSON.stringify(JSON.stringify(auth)) + ')' }]
      },
      configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://fixture')
        if (!url.pathname.startsWith('/api/')) return next()
        const scenario = String(req.headers.authorization || '').replace('Bearer fixture-', '') || 'normal'
        const entry = { method: req.method, path: url.pathname, scenario }
        requests.push(entry)
        try {
          const chunks = []; for await (const chunk of req) chunks.push(chunk)
          const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
          if (input?.folio) entry.folio = input.folio
          const result = state.handle(req.method, url, scenario, input)
          entry.status = result.status
          if (result.delay) await new Promise((resolve) => setTimeout(resolve, result.delay))
          if (result.drop) { req.socket.destroy(); return }
          res.writeHead(result.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result.body))
        } catch {
          entry.status = 400
          res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, message: 'Solicitud de simulación no válida.' }))
        }
      }) },
    }],
    server: { host: '127.0.0.1', port, strictPort: true },
  })
  await server.listen()
  const address = server.httpServer.address()
  return { server, url: 'http://127.0.0.1:' + address.port, stats: () => ({ ...state.summary(), requests }) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startPosFixture(Number(process.env.POS_FIXTURE_PORT ?? 5174))
  process.stdout.write('Fixture aislado POS listo en ' + fixture.url + '/pos\n')
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', async (chunk) => {
    if (chunk.trim() === 'stats') process.stdout.write(JSON.stringify(fixture.stats()) + '\n')
    if (chunk.trim() === 'stop') { await fixture.server.close(); process.exit(0) }
  })
}
