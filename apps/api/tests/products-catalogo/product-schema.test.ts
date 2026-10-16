import test from "node:test";
import assert from "node:assert/strict";
import { createProductSchema, updateProductSchema, productQuerySchema, productStatusSchema } from "../../src/modules/products/product.schema.js";

const minimal = { sku: "PRUEBA-001", nombre: "Producto de prueba", unidad_medida_id: "1" };

test("alta mínima y decimales normalizados", () => {
  const value = createProductSchema.parse(minimal);
  assert.equal(value.unidad_medida_id, 1n);
  assert.equal(value.precio_venta, "0.00");
  assert.deepEqual(value.impuesto_ids, []);
});
test("código de barras conserva ceros iniciales", () => {
  assert.equal(createProductSchema.parse({ ...minimal, codigo_barras: "0012345" }).codigo_barras, "0012345");
});
test("rechaza inyección de empresa, estado e inventario", () => {
  for (const field of ["empresa_id", "activo", "existencia", "usuario_id"]) {
    assert.equal(createProductSchema.safeParse({ ...minimal, [field]: "1" }).success, false);
  }
});
test("rechaza IDs numéricos para evitar pérdida de precisión", () => {
  assert.equal(createProductSchema.safeParse({ ...minimal, unidad_medida_id: 1 }).success, false);
});
test("validación de importes e impuestos duplicados", () => {
  assert.equal(createProductSchema.safeParse({ ...minimal, precio_venta: "12.001" }).success, false);
  assert.equal(createProductSchema.safeParse({ ...minimal, impuesto_ids: ["1", "01"] }).success, false);
  assert.equal(createProductSchema.safeParse({ ...minimal, costo_referencia: "-1" }).success, false);
});
test("PATCH sin valores por defecto, permite eliminar categoría", () => {
  assert.deepEqual(updateProductSchema.parse({ nombre: "Nuevo" }), { nombre: "Nuevo" });
  assert.deepEqual(updateProductSchema.parse({ categoria_id: null }), { categoria_id: null });
});
test("PATCH vacío o de campos operativos se rechaza", () => {
  assert.equal(updateProductSchema.safeParse({}).success, false);
  for (const [field, value] of [["empresa_id", "2"], ["unidad_medida_id", "2"], ["tipo", "SERVICIO"], ["controla_inventario", false], ["activo", false], ["sku", "OTRO"], ["codigo_barras", "OTRO"]]) {
    assert.equal(updateProductSchema.safeParse({ [String(field)]: value }).success, false);
  }
});
test("activo=false no se convierte en true por coerción", () => {
  assert.equal(productQuerySchema.parse({ activo: "false" }).activo, false);
  assert.equal(productQuerySchema.parse({}).activo, undefined);
  assert.equal(productQuerySchema.safeParse({ activo: "0" }).success, false);
  assert.equal(productStatusSchema.safeParse({ activo: "false" }).success, false);
});
test("paginación acotada y filtros repetidos inválidos", () => {
  assert.deepEqual(productQuerySchema.parse({}), { page: 1, limit: 20 });
  for (const query of [{ limit: "101" }, { page: "0" }, { page: "1.5" }, { search: ["uno", "dos"] }, { categoria_id: "9223372036854775808" }]) {
    assert.equal(productQuerySchema.safeParse(query).success, false);
  }
});
