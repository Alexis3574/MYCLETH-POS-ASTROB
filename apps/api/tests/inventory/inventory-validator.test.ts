import assert from "node:assert/strict";
import test from "node:test";
import { createAdjustmentSchema } from "../../src/modules/inventory/inventory.schema.ts";
import { InventoryError } from "../../src/modules/inventory/errors/inventory.errors.ts";
import { validateAdjustmentQuantity } from "../../src/modules/inventory/validators/inventory-adjustment.validator.ts";
import { stockState } from "../../src/modules/inventory/utils/inventory.serializer.ts";

const product = { codigo_barras: "123", unidad_medida: { permite_decimales: true } };
const stock = { cantidad: "10.000", disponible: "3.000" };
const input = (changes: Record<string, unknown> = {}) => createAdjustmentSchema.parse({ almacen_id: "1", producto_id: "2", tipo: "AJUSTE_NEGATIVO", cantidad: "3", motivo: "Conteo", ...changes });
const code = (expected: string) => (error: unknown) => error instanceof InventoryError && error.code === expected;

test("salida se limita a disponible, respetando reservado", () => {
  assert.doesNotThrow(() => validateAdjustmentQuantity(input(), product, stock));
  assert.throws(() => validateAdjustmentQuantity(input({ cantidad: "4" }), product, stock), code("INVENTORY_INSUFFICIENT_AVAILABLE"));
});

test("unidad entera rechaza decimales incluso si el ajuste es local", () => {
  assert.throws(() => validateAdjustmentQuantity(input({ cantidad: "0.500", sincronizar_ecommerce: false }), { ...product, unidad_medida: { permite_decimales: false } }, stock), code("INVENTORY_UNIT_REQUIRES_INTEGER"));
  assert.doesNotThrow(() => validateAdjustmentQuantity(input({ cantidad: "0.500", sincronizar_ecommerce: false }), product, stock));
});

test("sin código de barras no se crea un evento imposible de resolver", () => {
  assert.throws(() => validateAdjustmentQuantity(input(), { ...product, codigo_barras: null }, stock), code("INVENTORY_BARCODE_REQUIRED"));
  assert.doesNotThrow(() => validateAdjustmentQuantity(input({ sincronizar_ecommerce: false }), { ...product, codigo_barras: null }, stock));
});

test("las entradas respetan el máximo de la existencia", () => {
  const positive = input({ tipo: "AJUSTE_POSITIVO", cantidad: "1", sincronizar_ecommerce: false });
  assert.throws(() => validateAdjustmentQuantity(positive, product, { cantidad: "99999999999.999", disponible: "99999999999.999" }), code("INVENTORY_STOCK_LIMIT"));
});

test("disponible existente se lee; null indica inconsistencia", () => {
  assert.equal(stockState({ cantidad: "10", reservado: "7", disponible: "3", costo_promedio: "1" }).disponible, "3.000");
  assert.throws(() => stockState({ cantidad: "10", reservado: "7", disponible: null, costo_promedio: "1" }), code("INVENTORY_DATABASE_INVARIANT"));
  assert.deepEqual(stockState(null), { cantidad: "0.000", reservado: "0.000", disponible: "0.000", costo_promedio: "0.0000" });
});
