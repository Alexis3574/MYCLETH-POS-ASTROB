import test from "node:test";
import assert from "node:assert/strict";
import { cancelTransferSchema, completeTransferSchema, createTransferSchema, transferKeySchema, transferQuerySchema } from "../../src/modules/transfers/transfer.schema.js";

const input = { almacen_origen_id: "1", almacen_destino_id: "2", detalles: [{ producto_id: "3", cantidad: "1.125" }] };

test("acepta IDs BIGINT como cadenas y normaliza tres decimales", () => {
  const result = createTransferSchema.parse(input);
  assert.equal(result.almacen_origen_id, 1n);
  assert.equal(result.detalles[0]!.cantidad, "1.125");
  assert.equal(result.observaciones, null);
});

test("rechaza origen igual al destino, duplicados, cantidades inválidas y campos ajenos", () => {
  for (const body of [
    { ...input, almacen_destino_id: "1" }, { ...input, detalles: [] },
    { ...input, detalles: [input.detalles[0], input.detalles[0]] },
    { ...input, empresa_id: "9" }, { ...input, sincronizar_ecommerce: true },
    { ...input, detalles: [{ producto_id: "3", cantidad: "0" }] },
    { ...input, detalles: [{ producto_id: "3", cantidad: "-1" }] },
    { ...input, detalles: [{ producto_id: "3", cantidad: "0.0001" }] },
    { ...input, detalles: [{ producto_id: "3", cantidad: 1.0000000000000001 }] },
    { ...input, detalles: [{ producto_id: "9223372036854775808", cantidad: "1" }] },
    { ...input, detalles: [{ producto_id: "3", cantidad: "1", costo_unitario: "0" }] },
  ]) assert.equal(createTransferSchema.safeParse(body).success, false);
});

test("valida estados, rangos de fechas y cuerpos de operación", () => {
  assert.equal(transferQuerySchema.safeParse({ estado: "EN_TRANSITO" }).success, false);
  assert.equal(transferQuerySchema.safeParse({ fecha_desde: "2026-10-08T00:00:00Z", fecha_hasta: "2026-10-07T00:00:00Z" }).success, false);
  assert.equal(cancelTransferSchema.safeParse({ motivo: " " }).success, false);
  assert.equal(completeTransferSchema.safeParse({ cantidad: 1 }).success, false);
  assert.equal(transferKeySchema.safeParse("123").success, false);
  assert.equal(transferQuerySchema.parse({}).limit, 20);
});
