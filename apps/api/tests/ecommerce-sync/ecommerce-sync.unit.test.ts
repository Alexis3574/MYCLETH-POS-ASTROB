import assert from "node:assert/strict";
import test from "node:test";
import {
  syncIdSchema,
  syncListSchema
} from "../../src/modules/ecommerce-sync/ecommerce-sync.schema.js";

test("acepta IDs BIGINT exactos", () => {
  assert.equal(
    syncIdSchema.parse("9223372036854775807"),
    9223372036854775807n
  );
});

test("rechaza IDs inválidos", () => {
  for (const id of [
    "0", "-1", "01", "1e5",
    "9223372036854775808"
  ]) {
    assert.equal(syncIdSchema.safeParse(id).success, false);
  }
});

test("filtros por defecto y paginación", () => {
  const data = syncListSchema.parse({});
  assert.equal(data.page, 1);
  assert.equal(data.pageSize, 20);
});

test("rechaza parámetros inyectados", () => {
  assert.equal(
    syncListSchema.safeParse({ empresa_id: "1" }).success,
    false
  );
});

test("rechaza paginación y fechas inválidas", () => {
  assert.equal(
    syncListSchema.safeParse({ pageSize: "101" }).success,
    false
  );

  assert.equal(
    syncListSchema.safeParse({
      fecha_desde: "2026-10-30T20:00:00Z",
      fecha_hasta: "2026-10-29T20:00:00Z"
    }).success,
    false
  );
});
