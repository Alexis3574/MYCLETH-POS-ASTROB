import test from "node:test";
import assert from "node:assert/strict";

const base = new URL(
  process.env.POS_HTTP_URL || "http://127.0.0.1:3000"
);

if (
  base.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(base.hostname)
) {
  throw new Error("Solo se permite un servidor HTTP local.");
}

const checks = [
  {
    name: "Auth /me sin token",
    path: "/api/v1/auth/me",
    expected: 401,
  },
  {
    name: "Auth /me con token inválido",
    path: "/api/v1/auth/me",
    token: "invalid-token",
    expected: 401,
  },
  {
    name: "Inventario sin token",
    path: "/api/v1/inventory/warehouses",
    expected: 401,
  },
  {
    name: "Inventario con token inválido",
    path: "/api/v1/inventory/warehouses",
    token: "invalid-token",
    expected: 401,
  },
  {
    name: "Transferencias sin token",
    path: "/api/v1/transfers",
    expected: 401,
  },
  {
    name: "Transferencias con token inválido",
    path: "/api/v1/transfers",
    token: "invalid-token",
    expected: 401,
  },
  {
    name: "Login con datos incompletos",
    path: "/api/v1/auth/login",
    method: "POST",
    body: {},
    expected: 400,
  },
];

for (const check of checks) {
  test(check.name, async () => {
    const response = await fetch(
      base.origin + check.path,
      {
        method: check.method || "GET",
        headers: {
          ...(check.token
            ? { Authorization: `Bearer ${check.token}` }
            : {}),
          ...(check.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
        },
        ...(check.body !== undefined
          ? { body: JSON.stringify(check.body) }
          : {}),
        signal: AbortSignal.timeout(10000),
      }
    );

    assert.equal(
      response.status,
      check.expected,
      `${check.name}: HTTP ${response.status}, esperado ${check.expected}`
    );
  });
}
