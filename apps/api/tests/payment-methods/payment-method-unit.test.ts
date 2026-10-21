import test from "node:test";
import assert from "node:assert/strict";
import { paymentMethodIdSchema, paymentMethodListSchema } from "../../src/modules/payment-methods/payment-method.schema.js";
import { paymentMethodFilter, serializePaymentMethod } from "../../src/modules/payment-methods/utils/payment-method.values.js";

test("paginación predeterminada y activos por defecto", () => {
  assert.deepEqual(paymentMethodListSchema.parse({}), {
    page: 1, pageSize: 25, activo: "true",
  });
});
test("paginación explícita, estado y filtros", () => {
  assert.deepEqual(paymentMethodListSchema.parse({ page: "2", pageSize: "15", activo: "all", codigo: " efectivo ", q: " tarjeta " }), {
    page: 2, pageSize: 15, activo: "all", codigo: "EFECTIVO", q: "tarjeta",
  });
});
test("rechaza pageSize 0, excedido y fraccional", () => {
  for (const value of ["0", "101", "1.5", "-1", "Infinity"]) assert.equal(paymentMethodListSchema.safeParse({ pageSize: value }).success, false);
});
test("rechaza page 0, excedido y notación exponencial", () => {
  for (const value of ["0", "1000001", "1e2", "01", "-1"]) assert.equal(paymentMethodListSchema.safeParse({ page: value }).success, false);
});
test("rechaza estado inválido y filtros de inyección multiempresa", () => {
  assert.equal(paymentMethodListSchema.safeParse({ activo: "yes" }).success, false);
  assert.equal(paymentMethodListSchema.safeParse({ empresa_id: "2" }).success, false);
  assert.equal(paymentMethodListSchema.safeParse({ es_efectivo: "true" }).success, false);
});
test("rechaza códigos con operadores o caracteres ajenos", () => {
  for (const value of ["EFECTIVO;DROP", "ab cd", "á", ""]) assert.equal(paymentMethodListSchema.safeParse({ codigo: value }).success, false);
});
test("rechaza búsquedas vacías o de longitud excesiva", () => {
  assert.equal(paymentMethodListSchema.safeParse({ q: "    " }).success, false);
  assert.equal(paymentMethodListSchema.safeParse({ q: "a".repeat(81) }).success, false);
});
test("acepta límite PostgreSQL BIGINT firmado", () => {
  assert.equal(paymentMethodIdSchema.parse("9223372036854775807"), 9223372036854775807n);
});
test("rechaza IDs no canónicos, 0, negativos o fuera de BIGINT", () => {
  for (const id of ["0", "-1", "1.0", "1e2", "01", "9223372036854775808", "999999999999999999999999999999", "abc"])
    assert.equal(paymentMethodIdSchema.safeParse(id).success, false, id);
});
test("filtro activo false o all y código normalizado", () => {
  assert.deepEqual(paymentMethodFilter(paymentMethodListSchema.parse({ activo: "false" })), { activo: false });
  assert.deepEqual(paymentMethodFilter(paymentMethodListSchema.parse({ activo: "all", codigo: "tarjeta" })), { codigo: "TARJETA" });
});
test("búsqueda usa condición OR case-insensitive", () => {
  assert.deepEqual(paymentMethodFilter(paymentMethodListSchema.parse({ q: "Crédito" })), {
    activo: true,
    OR: [
      { codigo: { contains: "Crédito", mode: "insensitive" } },
      { nombre: { contains: "Crédito", mode: "insensitive" } },
    ],
  });
});
test("serialización JSON sin pérdida de bigint ni banderas", () => {
  assert.deepEqual(serializePaymentMethod({ id: 9223372036854775807n, codigo: "CREDITO", nombre: "Crédito", activo: false, es_efectivo: false }), {
    id: "9223372036854775807", codigo: "CREDITO", nombre: "Crédito", activo: false, es_efectivo: false,
  });
});
