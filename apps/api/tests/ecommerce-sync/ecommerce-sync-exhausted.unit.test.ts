
import assert from "node:assert/strict";
import test from "node:test";
import { syncListSchema } from "../../src/modules/ecommerce-sync/ecommerce-sync.schema.js";

test("permite filtrar por AGOTADO", () => {
  const parsed = syncListSchema.parse({ estado: "AGOTADO" });
  assert.equal(parsed.estado, "AGOTADO");
});

test("rechaza estados desconocidos", () => {
  assert.throws(() =>
    syncListSchema.parse({ estado: "SUSPENDIDO" })
  );
});
