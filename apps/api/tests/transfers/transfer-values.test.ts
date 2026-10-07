import test from "node:test";
import assert from "node:assert/strict";
import { createTransferContent, destinationAverage, normalizeDecimal, orderedDetails, transferRequestHash } from "../../src/modules/transfers/utils/transfer-values.js";

test("normaliza cantidades equivalentes sin aceptar precisión adicional", () => {
  assert.equal(normalizeDecimal("0001.5", 3), "1.500");
  assert.equal(normalizeDecimal("0.0001", 3), null);
  assert.equal(normalizeDecimal("100000000000", 3), null);
});

test("hash estable con productos reordenados y sensible a usuario, acción y destino", () => {
  const input = { almacen_origen_id: 1n, almacen_destino_id: 2n, observaciones: null,
    detalles: [{ producto_id: 12n, cantidad: "2.000" }, { producto_id: 3n, cantidad: "1.500" }] };
  const hash = transferRequestHash(1n, "CREAR", null, createTransferContent(input));
  assert.equal(hash, transferRequestHash(1n, "CREAR", null, createTransferContent({ ...input, detalles: [...input.detalles].reverse() })));
  assert.notEqual(hash, transferRequestHash(2n, "CREAR", null, createTransferContent(input)));
  assert.notEqual(hash, transferRequestHash(1n, "COMPLETAR", 1n, {}));
  assert.notEqual(hash, transferRequestHash(1n, "CREAR", null, createTransferContent({ ...input, almacen_destino_id: 9n })));
  assert.deepEqual(orderedDetails(input.detalles).map((item) => item.producto_id), [3n, 12n]);
});

test("conserva costo en destino vacío y pondera costo sin floats", () => {
  assert.equal(destinationAverage({ cantidad: "0.000", costo_promedio: "0.0000" }, "1.500", "12.3456"), "12.3456");
  assert.equal(destinationAverage({ cantidad: "2.000", costo_promedio: "10.0000" }, "2.000", "20.0000"), "15.0000");
  assert.equal(destinationAverage({ cantidad: "1.000", costo_promedio: "0.0000" }, "1.000", "0.0001"), "0.0001");
});
