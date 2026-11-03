/** Host HTTP local efímero para las pruebas CRUD Productos/Catálogo. No inicia el worker. */
import 'dotenv/config';
import { app } from '../../src/app.ts';
const server = app.listen(0,'127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Puerto no disponible');
  process.stdout.write(`INTEGRAL_HTTP_READY:${address.port}\n`);
});
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
