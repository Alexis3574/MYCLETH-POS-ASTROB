import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RETRY_POLICY,
  getRetryPolicy,
  retryDelayMs,
  retryDue,
  retryExhausted
} from "../../src/modules/inventory-sync/inventory-sync.retry-policy.js";

const policy = DEFAULT_RETRY_POLICY;

test("primeros reintentos con backoff exponencial", () => {
  assert.equal(retryDelayMs(1, policy), 30000);
  assert.equal(retryDelayMs(2, policy), 60000);
  assert.equal(retryDelayMs(3, policy), 120000);
  assert.equal(retryDelayMs(4, policy), 240000);
});

test("limita la espera máxima a 15 minutos", () => {
  assert.equal(retryDelayMs(10, policy), 900000);
  assert.equal(retryDelayMs(50, policy), 900000);
});

test("permite el primer intento inmediatamente", () => {
  assert.equal(retryDue(0, null, new Date(), policy), true);
});

test("bloquea reintentos antes del tiempo mínimo", () => {
  const now = new Date("2026-10-30T20:00:00.000Z");
  const previous = new Date("2026-10-30T19:59:45.000Z");
  assert.equal(retryDue(1, previous, now, policy), false);
});

test("habilita reintentos al cumplir el plazo", () => {
  const now = new Date("2026-10-30T20:00:00.000Z");
  const previous = new Date("2026-10-30T19:59:30.000Z");
  assert.equal(retryDue(1, previous, now, policy), true);
});

test("bloquea eventos con intentos agotados", () => {
  assert.equal(retryExhausted(9, policy), false);
  assert.equal(retryExhausted(10, policy), true);
  assert.equal(retryExhausted(561, policy), true);
  assert.equal(
    retryDue(10, null, new Date(), policy),
    false
  );
});

test("conserva configuración predeterminada", () => {
  const names = [
    "INVENTORY_SYNC_MAX_ATTEMPTS",
    "INVENTORY_SYNC_RETRY_BASE_DELAY_MS",
    "INVENTORY_SYNC_RETRY_MAX_DELAY_MS"
  ];

  const saved = names.map(name => process.env[name]);

  try {
    for (const name of names) delete process.env[name];
    assert.deepEqual(getRetryPolicy(), policy);
  } finally {
    names.forEach((name, i) => {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    });
  }
});
