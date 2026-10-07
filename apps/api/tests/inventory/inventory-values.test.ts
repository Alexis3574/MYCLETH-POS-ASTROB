import assert from "node:assert/strict";
import test from "node:test";
import { adjustmentHash, adjustmentOperationId, decimalUnits, formatSignedDecimal, normalizeDecimal, signedMovementUnits, validId } from "../../src/modules/inventory/utils/inventory-values.ts";

test("precisión de existencias e importes sin redondeos", () => {
  assert.equal(normalizeDecimal("00012.34", 3), "12.340");
  assert.equal(normalizeDecimal("99999999999.999", 3), "99999999999.999");
  assert.equal(normalizeDecimal("100000000000", 3), null);
  assert.equal(normalizeDecimal("1.0001", 3), null);
  for (const value of ["-1", "1e3", "1,5", "NaN", "", ".5"]) assert.equal(normalizeDecimal(value, 3), null);
  assert.equal(decimalUnits("0.001"), 1n);
  assert.equal(decimalUnits("99999999999.999"), 99999999999999n);
});

test("IDs dentro de BIGINT firmado", () => {
  assert.ok(validId("9223372036854775807"));
  for (const value of ["0", "-1", "9223372036854775808", "1.5", "1e3"]) assert.equal(validId(value), false);
});

test("signos de todos los movimientos del trigger", () => {
  for (const tipo of ["ENTRADA", "AJUSTE_POSITIVO", "TRANSFERENCIA_ENTRADA"] as const) assert.equal(signedMovementUnits(tipo, "2.125"), 2125n);
  for (const tipo of ["SALIDA", "AJUSTE_NEGATIVO", "TRANSFERENCIA_SALIDA"] as const) assert.equal(signedMovementUnits(tipo, "2.125"), -2125n);
});

test("el hash distingue contenido, usuario y política de sincronización", () => {
  const input = { almacen_id: 1n, producto_id: 2n, tipo: "AJUSTE_POSITIVO" as const, cantidad: "1.000", costo_unitario: null, motivo: "Conteo", sincronizar_ecommerce: true };
  assert.equal(adjustmentHash(3n, input), adjustmentHash(3n, { ...input }));
  for (const changed of [{ ...input, cantidad: "2.000" }, { ...input, almacen_id: 4n }, { ...input, sincronizar_ecommerce: false }, { ...input, motivo: "Otro" }]) {
    assert.notEqual(adjustmentHash(3n, input), adjustmentHash(3n, changed));
  }
  assert.notEqual(adjustmentHash(3n, input), adjustmentHash(4n, input));
});

test("operation_id único y compatible con el límite de la outbox", () => {
  const large = 9223372036854775807n;
  assert.ok(adjustmentOperationId(large, large, "AJUSTE_NEGATIVO").length <= 120);
  assert.notEqual(adjustmentOperationId(1n, 2n, "AJUSTE_POSITIVO"), adjustmentOperationId(2n, 2n, "AJUSTE_POSITIVO"));
  assert.notEqual(adjustmentOperationId(1n, 2n, "AJUSTE_POSITIVO"), adjustmentOperationId(1n, 3n, "AJUSTE_POSITIVO"));
});

test("saldos reconstruidos conservan signo y precisión", () => {
  assert.equal(formatSignedDecimal("-12.5", 3), "-12.500");
  assert.equal(formatSignedDecimal("-0.000", 3), "0.000");
  assert.equal(formatSignedDecimal("150000000000.001", 3), "150000000000.001");
  assert.throws(() => formatSignedDecimal("1.0001", 3));
});
