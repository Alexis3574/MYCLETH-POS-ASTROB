import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = (process.env.INVENTORY_API_URL || "http://localhost:3000").replace(/\/$/, "");
const readToken = process.env.INVENTORY_READ_TOKEN;
const deniedToken = process.env.INVENTORY_DENIED_ADJUST_TOKEN;
const adjustToken = process.env.INVENTORY_ADJUST_TOKEN;
let checks = 0;

async function request(relativeUrl, { token, expected = 200, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}/api/v1/inventory${relativeUrl}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === "POST" ? { "Content-Type": "application/json", "Idempotency-Key": randomUUID() } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${relativeUrl}: ${JSON.stringify(data)}`);
  checks++;
  console.log(`[OK] ${method} ${relativeUrl} → ${response.status}`);
  return data;
}

try {
  assert.ok(readToken, "Define INVENTORY_READ_TOKEN con un JWT que tenga INVENTARIO.VER.");
  await request("/warehouses", { expected: 401 });
  await request("/warehouses", { token: "invalid-token", expected: 401 });
  const warehouses = await request("/warehouses?limit=100", { token: readToken });
  const warehouseId = process.env.INVENTORY_WAREHOUSE_ID || warehouses.data[0]?.id;
  assert.ok(warehouseId, "Se necesita un almacén de tu empresa para consultar existencias.");
  const stock = await request(`/stock?almacen_id=${encodeURIComponent(warehouseId)}&limit=100`, { token: readToken });
  await request(`/movements?almacen_id=${encodeURIComponent(warehouseId)}&limit=10`, { token: readToken });
  const productId = process.env.INVENTORY_PRODUCT_ID || stock.data[0]?.producto.id;
  if (productId) await request(`/kardex?almacen_id=${encodeURIComponent(warehouseId)}&producto_id=${encodeURIComponent(productId)}&limit=10`, { token: readToken });
  else console.log("[PENDIENTE] Kardex: falta un producto que controle inventario.");
  await request(`/stock?almacen_id=${encodeURIComponent(warehouseId)}&page=0`, { token: readToken, expected: 400 });
  await request("/stock", { token: readToken, expected: 400 });
  if (deniedToken) await request("/adjustments", { token: deniedToken, method: "POST", body: {}, expected: 403 });
  else console.log("[PENDIENTE] Permiso de ajuste: falta INVENTORY_DENIED_ADJUST_TOKEN de un usuario sin INVENTARIO.AJUSTAR.");
  if (adjustToken) await request("/adjustments", { token: adjustToken, method: "POST", body: {}, expected: 400 });
  else console.log("[PENDIENTE] Validación HTTP del ajuste: falta INVENTORY_ADJUST_TOKEN.");
  if (process.env.INVENTORY_FOREIGN_WAREHOUSE_ID) await request(`/stock?almacen_id=${encodeURIComponent(process.env.INVENTORY_FOREIGN_WAREHOUSE_ID)}`, { token: readToken, expected: 404 });
  if (productId && process.env.INVENTORY_FOREIGN_PRODUCT_ID) await request(`/kardex?almacen_id=${encodeURIComponent(warehouseId)}&producto_id=${encodeURIComponent(process.env.INVENTORY_FOREIGN_PRODUCT_ID)}`, { token: readToken, expected: 404 });
  console.log(`\n${checks} comprobaciones HTTP correctas. Los POST usan un cuerpo inválido y no crean ajustes.`);
  console.log("Las comprobaciones PENDIENTE deben completarse antes de cerrar Inventario.");
  console.log("Productos/Catálogo sigue pendiente de validación funcional.");
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
}
