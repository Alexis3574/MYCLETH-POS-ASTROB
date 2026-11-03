import test from "node:test";
import assert from "node:assert/strict";

import {
  settingKeys,
  settingDefaults,
  settingKeySchema,
  parseSettingValue,
  updateSettingSchema,
} from "./company-settings.schema.js";

test("M15: cuatro categorias autorizadas", () => {
  assert.deepEqual(settingKeys, [
    "ventas", "inventario", "comprobantes", "interfaz",
  ]);
  assert.equal(settingKeySchema.safeParse("usuarios").success, false);
});

test("M15: valores predeterminados validos", () => {
  for (const key of settingKeys) {
    assert.deepEqual(
      parseSettingValue(key, settingDefaults[key]),
      settingDefaults[key],
    );
  }
});

test("M15: rechaza configuraciones desconocidas", () => {
  assert.throws(() =>
    parseSettingValue("ventas", {
      ...settingDefaults.ventas,
      password: "no-permitido",
    })
  );
});

test("M15: rechaza tipos incorrectos", () => {
  assert.throws(() =>
    parseSettingValue("inventario", {
      mostrar_alertas_stock_bajo: "true",
      umbral_stock_bajo: 5,
    })
  );
});

test("M15: valida limites numericos", () => {
  assert.throws(() =>
    parseSettingValue("inventario", {
      mostrar_alertas_stock_bajo: true,
      umbral_stock_bajo: -1,
    })
  );
});

test("M15: valida leyenda del ticket", () => {
  assert.throws(() =>
    parseSettingValue("comprobantes", {
      ...settingDefaults.comprobantes,
      leyenda_ticket: "x".repeat(301),
    })
  );
});

test("M15: valida entrada de actualizacion", () => {
  assert.equal(
    updateSettingSchema.safeParse({
      valor: settingDefaults.ventas,
    }).success,
    true,
  );

  assert.equal(
    updateSettingSchema.safeParse({
      valor: settingDefaults.ventas,
      empresa_id: "2",
    }).success,
    false,
  );
});
