import assert from 'node:assert/strict';

// HTTP sobre un servidor de desarrollo bajo control del usuario (sin mutaciones).
const base = process.env.PURCHASES_HTTP_BASE;
const token = process.env.PURCHASES_HTTP_TOKEN;
if (!base || !token) throw new Error('Configure PURCHASES_HTTP_BASE y PURCHASES_HTTP_TOKEN de la base de pruebas local.');
const endpoint = new URL('/api/v1/purchases', base);
if (!['127.0.0.1','localhost'].includes(endpoint.hostname)) throw new Error('Solo se permiten API HTTP locales para la prueba.');
const unauthenticated = await fetch(endpoint, { signal: AbortSignal.timeout(10000) });
assert.equal(unauthenticated.status, 401, 'Debe exigir autenticación en consultas de Compras.');
const authenticated = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
assert.equal(authenticated.status, 200, `Compras JWT: HTTP ${authenticated.status}`);
const data = await authenticated.json();
assert.equal(data.ok, true);
assert.ok(Array.isArray(data.data?.items));
console.log('[OK] Autenticación ausente rechazada y consulta JWT real aprobada.');
