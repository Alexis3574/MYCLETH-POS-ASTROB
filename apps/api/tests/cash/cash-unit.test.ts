import test from "node:test";
import assert from "node:assert/strict";

import {
  createCashSchema,
  updateCashSchema,
  openCashSchema,
  movementSchema,
  closeCashSchema,
  paginationSchema,
  idFromRoute,
  nonNegativeMoney,
  positiveMoney,
} from "../../src/modules/cash/cash.schema.ts";

import {
  decimal,
  computeExpected,
  jsonSafe,
} from "../../src/modules/cash/cash.utils.ts";

import {
  CashError,
  cashError,
} from "../../src/modules/cash/cash.errors.ts";

const cash = {
  sucursal_id: "1",
  codigo: "CAJA01",
  nombre: "Caja principal",
};

test("creación válida de caja", () => {
  assert.equal(createCashSchema.safeParse(cash).success, true);
  assert.equal(createCashSchema.safeParse({
    ...cash,
    empresa_id: "2",
  }).success, false);
});

test("actualización de caja", () => {
  assert.equal(updateCashSchema.safeParse({}).success, false);
  assert.equal(updateCashSchema.safeParse({
    activo: false,
  }).success, true);
  assert.equal(updateCashSchema.safeParse({
    nombre: "Caja 2",
  }).success, true);
});

test("validación de montos", () => {
  assert.equal(nonNegativeMoney.safeParse("0.00").success, true);
  assert.equal(positiveMoney.safeParse("0.00").success, false);
  assert.equal(positiveMoney.safeParse("10.50").success, true);

  for (const amount of [
    "-1", "1.001", "1e3", "1000000000000",
  ]) {
    assert.equal(nonNegativeMoney.safeParse(amount).success, false);
  }
});

test("apertura de sesión", () => {
  assert.equal(openCashSchema.safeParse({
    monto_apertura: "500.00",
  }).success, true);

  assert.equal(openCashSchema.safeParse({
    monto_apertura: "-1",
  }).success, false);
});

test("movimientos de caja", () => {
  const movement = {
    tipo: "ENTRADA",
    concepto: "Ingreso manual",
    monto: "100.00",
    referencia: "MOV-001",
  };

  assert.equal(movementSchema.safeParse(movement).success, true);
  assert.equal(movementSchema.safeParse({
    ...movement,
    monto: "0",
  }).success, false);

  assert.equal(movementSchema.safeParse({
    ...movement,
    tipo: "OTRO",
  }).success, false);
});

test("cierre de sesión", () => {
  assert.equal(closeCashSchema.safeParse({
    monto_cierre: "0",
  }).success, true);

  assert.equal(closeCashSchema.safeParse({
    monto_cierre: "-10",
  }).success, false);
});

test("paginación", () => {
  assert.deepEqual(paginationSchema.parse({}), {
    page: 1,
    pageSize: 25,
  });

  assert.equal(paginationSchema.safeParse({
    page: 0,
  }).success, false);

  assert.equal(paginationSchema.safeParse({
    pageSize: 101,
  }).success, false);
});

test("validación de identificadores", () => {
  assert.equal(idFromRoute("1"), 1n);
  assert.equal(
    idFromRoute("9223372036854775807"),
    9223372036854775807n,
  );

  for (const value of [
    "0", "-1", "abc", "9223372036854775808",
  ]) {
    assert.throws(() => idFromRoute(value));
  }
});

test("saldo esperado de caja", () => {
  const result = computeExpected(decimal("100"), [
    { tipo: "ENTRADA", _sum: { monto: decimal("25.10") } },
    { tipo: "SALIDA", _sum: { monto: decimal("10.05") } },
  ]);

  assert.equal(result.toString(), "115.05");
});

test("serialización segura", () => {
  assert.deepEqual(jsonSafe({
    id: 10n,
    monto: decimal("12.34"),
  }), {
    id: "10",
    monto: "12.34",
  });
});

test("errores del módulo", () => {
  const error = cashError.notFound();

  assert.ok(error instanceof CashError);
  assert.equal(error.status, 404);
  assert.equal(error.code, "CASH_NOT_FOUND");

  assert.equal(cashError.forbidden().status, 403);
  assert.equal(cashError.conflict("Conflicto").status, 409);
});

test("sucursal respeta límite BIGINT", () => {
  assert.equal(createCashSchema.safeParse({
    ...cash,
    sucursal_id: "9223372036854775808",
  }).success, false);
});
