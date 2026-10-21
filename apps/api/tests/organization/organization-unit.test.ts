import test from "node:test";
import assert from "node:assert/strict";
import {
  organizationIdSchema, companyUpdateSchema, branchCreateSchema,
  branchUpdateSchema, warehouseCreateSchema, warehouseUpdateSchema,
  branchListSchema, assignmentCreateSchema,
} from "../../src/modules/organization/organization.schema.js";

test("ids BIGINT sin pérdida de precisión", () => {
  assert.equal(organizationIdSchema.parse("9223372036854775807"), 9223372036854775807n);
  for (const value of ["0", "-1", "9223372036854775808", "1.0", "1e2", "a", 1]) {
    assert.equal(organizationIdSchema.safeParse(value).success, false);
  }
});
test("la empresa autenticada no admite cambiar empresa_id ni activo", () => {
  assert.equal(companyUpdateSchema.safeParse({ empresa_id: "33" }).success, false);
  assert.equal(companyUpdateSchema.safeParse({ activo: false }).success, false);
  assert.equal(companyUpdateSchema.safeParse({}).success, false);
  assert.equal(companyUpdateSchema.safeParse({ nombre_comercial: "Nueva Marca" }).success, true);
});
test("códigos se normalizan y duplicados de campos se rechazan", () => {
  const branch = branchCreateSchema.parse({ codigo: " mx-01 ", nombre: " Principal " });
  assert.equal(branch.codigo, "MX-01");
  assert.equal(branch.nombre, "Principal");
  assert.equal(branchCreateSchema.safeParse({ empresa_id: "2", codigo: "MX", nombre: "Principal" }).success, false);
  assert.equal(branchUpdateSchema.safeParse({}).success, false);
  assert.equal(branchUpdateSchema.safeParse({ sucursal_id: "2" }).success, false);
});
test("almacén no cambia de sucursal mediante PATCH", () => {
  assert.equal(warehouseCreateSchema.safeParse({ sucursal_id: "1", codigo: " a ", nombre: "Bodega" }).success, true);
  assert.equal(warehouseCreateSchema.safeParse({ sucursal_id: "0", codigo: "A", nombre: "Bodega" }).success, false);
  assert.equal(warehouseUpdateSchema.safeParse({ sucursal_id: "3" }).success, false);
  assert.equal(warehouseUpdateSchema.safeParse({}).success, false);
});
test("paginación, filtros y asignaciones seguros", () => {
  assert.deepEqual(branchListSchema.parse({}), { page: 1, pageSize: 25 });
  assert.equal(branchListSchema.safeParse({ pageSize: 101 }).success, false);
  assert.equal(assignmentCreateSchema.safeParse({ usuario_id: "22", es_predeterminada: true }).success, true);
  assert.equal(assignmentCreateSchema.safeParse({ usuario_id: "22", empresa_id: "1" }).success, false);
});
