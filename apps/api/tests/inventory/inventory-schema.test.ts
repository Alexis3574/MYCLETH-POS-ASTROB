import assert from "node:assert/strict";
import test from "node:test";
import { createAdjustmentSchema, idempotencyKeySchema, kardexQuerySchema, movementsQuerySchema, stockQuerySchema } from "../../src/modules/inventory/inventory.schema.ts";

const body = { almacen_id: "1", producto_id: "2", tipo: "AJUSTE_POSITIVO", cantidad: "1", motivo: "Conteo físico" };

test("normalización y valores predeterminados del ajuste", () => {
  const parsed = createAdjustmentSchema.parse(body);
  assert.equal(parsed.almacen_id, 1n);
  assert.equal(parsed.cantidad, "1.000");
  assert.equal(parsed.costo_unitario, null);
  assert.equal(parsed.sincronizar_ecommerce, true);
  assert.deepEqual(createAdjustmentSchema.parse({ ...body, cantidad: "1.000" }), parsed);
});

test("empresa y usuario se obtienen de auth; campos extras rechazados", () => {
  for (const field of ["empresa_id", "usuario_id", "reservado", "disponible", "fecha", "operation_id"]) {
    assert.equal(createAdjustmentSchema.safeParse({ ...body, [field]: "1" }).success, false);
  }
});

test("cantidad positiva y precisión máxima", () => {
  for (const cantidad of ["0", "-1", "1.0001", "1e2", "100000000000", "NaN"]) {
    assert.equal(createAdjustmentSchema.safeParse({ ...body, cantidad, sincronizar_ecommerce: false }).success, false);
  }
  assert.equal(createAdjustmentSchema.safeParse({ ...body, cantidad: "0.001", sincronizar_ecommerce: false }).success, true);
});

test("sync solo permite enteros en el rango INTEGER de PostgreSQL", () => {
  assert.equal(createAdjustmentSchema.safeParse({ ...body, cantidad: "1.500" }).success, false);
  assert.equal(createAdjustmentSchema.safeParse({ ...body, cantidad: "2147483648" }).success, false);
  assert.equal(createAdjustmentSchema.safeParse({ ...body, cantidad: "2147483647" }).success, true);
});

test("costo solo para ajustes positivos y motivo obligatorio", () => {
  assert.equal(createAdjustmentSchema.safeParse({ ...body, tipo: "AJUSTE_NEGATIVO", costo_unitario: "0" }).success, false);
  assert.equal(createAdjustmentSchema.safeParse({ ...body, tipo: "AJUSTE_NEGATIVO" }).success, true);
  assert.equal(createAdjustmentSchema.safeParse({ ...body, motivo: "  " }).success, false);
  assert.equal(createAdjustmentSchema.safeParse({ ...body, costo_unitario: "1.00001" }).success, false);
  assert.equal(createAdjustmentSchema.safeParse({ ...body, tipo: "SALIDA" }).success, false);
});

test("clave UUID obligatoria y normalizada", () => {
  const key = "D1818F9B-CF08-4D11-9A28-62962E66816F";
  assert.equal(idempotencyKeySchema.parse(key), key.toLowerCase());
  for (const invalid of [undefined, "", "texto", "123"]) assert.equal(idempotencyKeySchema.safeParse(invalid).success, false);
});

test("paginación, filtros y almacén obligatorio", () => {
  assert.deepEqual(stockQuerySchema.parse({ almacen_id: "1" }), { almacen_id: 1n, page: 1, limit: 20 });
  for (const query of [{}, { almacen_id: "1", page: "0" }, { almacen_id: "1", limit: "101" }, { almacen_id: "1", activo: "1" }, { almacen_id: "1", empresa_id: "2" }]) {
    assert.equal(stockQuerySchema.safeParse(query).success, false);
  }
});

test("fechas ISO con zona horaria y rangos ordenados", () => {
  assert.equal(kardexQuerySchema.safeParse({ almacen_id: "1", producto_id: "2", fecha_desde: "2026-10-07T00:00:00-06:00", fecha_hasta: "2026-10-07T23:59:59-06:00" }).success, true);
  assert.equal(movementsQuerySchema.safeParse({ fecha_desde: "2026-10-08T00:00:00Z", fecha_hasta: "2026-10-07T00:00:00Z" }).success, false);
  assert.equal(movementsQuerySchema.safeParse({ fecha_desde: "2026-10-07" }).success, false);
  assert.equal(kardexQuerySchema.safeParse({ almacen_id: "1", producto_id: "2", tipo: "SALIDA" }).success, false);
});
