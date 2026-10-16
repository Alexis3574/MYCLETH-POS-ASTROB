import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

if (process.env.TRANSFERS_HTTP_TEST_ENABLED !== "true" || process.env.TRANSFERS_HTTP_ISOLATED_ENVIRONMENT !== "true") {
  throw new Error("La prueba HTTP requiere habilitación explícita y un entorno aislado.");
}
const base = process.env.TRANSFERS_HTTP_API_URL?.replace(/\/$/, "");
const token = process.env.TRANSFERS_HTTP_TOKEN;
const readToken = process.env.TRANSFERS_HTTP_READ_ONLY_TOKEN;
const foreignToken = process.env.TRANSFERS_HTTP_OTHER_COMPANY_TOKEN;
if (!base || !token || !readToken || !foreignToken || !process.env.TRANSFERS_HTTP_BODY_JSON) {
  throw new Error("Falta URL, cuerpo o alguno de los tokens de prueba.");
}
const input = JSON.parse(process.env.TRANSFERS_HTTP_BODY_JSON);

async function request(path, { method = "GET", body, key, credential = token } = {}) {
  const response = await fetch(`${base}/api/v1/transfers${path}`, {
    method, signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json",
      ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { response, body: await response.json() };
}

assert.equal((await request("", { credential: "" })).response.status, 401);
assert.equal((await request("", { method: "POST", body: input, key: randomUUID(), credential: readToken })).response.status, 403);
assert.equal((await request("", { method: "POST", body: input })).response.status, 400);
const key = randomUUID();
const created = await request("", { method: "POST", body: input, key });
assert.equal(created.response.status, 201);
const id = created.body.data.transferencia.id;
assert.equal((await request(`/${id}`, { credential: foreignToken })).response.status, 404);
const replay = await request("", { method: "POST", body: input, key });
assert.equal(replay.response.status, 200);
assert.equal(replay.body.replayed, true);
assert.deepEqual(replay.body.data, created.body.data);
assert.equal((await request("", { method: "POST", body: { ...input, observaciones: `Cambio ${randomUUID()}` }, key })).response.status, 409);
assert.equal((await request(`/${id}`)).response.status, 200);
const completeKey = randomUUID();
const completed = await request(`/${id}/complete`, { method: "POST", body: {}, key: completeKey });
assert.equal(completed.response.status, 200);
assert.equal(completed.body.data.transferencia.estado, "COMPLETADA");
assert.equal(completed.body.data.movimientos.length, input.detalles.length * 2);
assert.equal(completed.body.data.ecommerce.eventos_creados, 0);
const completedReplay = await request(`/${id}/complete`, { method: "POST", body: {}, key: completeKey });
assert.deepEqual(completedReplay.body.data, completed.body.data);
assert.equal((await request(`/${id}/cancel`, { method: "POST", body: { motivo: "Prueba" }, key: randomUUID() })).response.status, 409);
const cancelDraft = await request("", { method: "POST", body: { ...input, folio: `TR-${randomUUID()}` }, key: randomUUID() });
assert.equal(cancelDraft.response.status, 201);
const cancelId = cancelDraft.body.data.transferencia.id;
const cancelKey = randomUUID();
const canceled = await request(`/${cancelId}/cancel`, { method: "POST", body: { motivo: "Prueba de cancelación" }, key: cancelKey });
assert.equal(canceled.body.data.transferencia.estado, "CANCELADA");
const canceledReplay = await request(`/${cancelId}/cancel`, { method: "POST", body: { motivo: "Prueba de cancelación" }, key: cancelKey });
assert.deepEqual(canceledReplay.body.data, canceled.body.data);
assert.equal((await request(`/${cancelId}/complete`, { method: "POST", body: {}, key: randomUUID() })).response.status, 409);
console.log({ ok: true, transferencia_completada: id, transferencia_cancelada: cancelId, alcance: "HTTP, permisos e idempotencia; sin sincronización remota." });
