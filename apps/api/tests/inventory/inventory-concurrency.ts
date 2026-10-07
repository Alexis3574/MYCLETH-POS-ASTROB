/** Ejecutar únicamente sobre una base de pruebas aislada con las migraciones aplicadas. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testUrl = process.env.INVENTORY_CONCURRENCY_DATABASE_URL;
if (!testUrl) throw new Error("Define INVENTORY_CONCURRENCY_DATABASE_URL con la conexión a tu base de pruebas aislada.");
const databaseName = decodeURIComponent(new URL(testUrl).pathname.slice(1));
if (!/(?:test|prueba)/i.test(databaseName)) throw new Error("El nombre de la base de concurrencia debe contener test o prueba.");
process.env.DATABASE_URL = testUrl;
process.env.INVENTORY_SYNC_ENABLED = "false";

// La conexión se define antes de importar el Prisma del proyecto.
const { prisma } = await import("../../src/lib/prisma.js");
const { createAdjustmentSchema } = await import("../../src/modules/inventory/inventory.schema.js");
const { inventoryAdjustmentService } = await import("../../src/modules/inventory/services/inventory-adjustment.service.js");
const { InventoryError } = await import("../../src/modules/inventory/errors/inventory.errors.js");
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
let fixture: { companyId: bigint; warehouseId: bigint; userId: bigint; productId: bigint; unitId: bigint } | undefined;

try {
  fixture = await prisma.$transaction(async (tx) => {
    const company = await tx.empresa.create({ data: { razon_social: `INVCONC_${suffix}`, nombre_comercial: `INVCONC_${suffix}` } });
    const branch = await tx.sucursal.create({ data: { empresa_id: company.id, codigo: "TEST", nombre: "Prueba concurrente" } });
    const warehouse = await tx.almacen.create({ data: { sucursal_id: branch.id, codigo: "TEST", nombre: "Prueba concurrente" } });
    const user = await tx.usuario.create({ data: { empresa_id: company.id, username: `invconc_${suffix}`, nombre: "Prueba", password_hash: "synthetic-test-only" } });
    const unit = await tx.unidad_medida.create({ data: { codigo: `IC_${suffix}`, nombre: "Prueba concurrente" } });
    const product = await tx.producto.create({ data: { empresa_id: company.id, sku: `IC_${suffix}`, codigo_barras: `INVCONC-${suffix}`, nombre: "Prueba concurrente", unidad_medida_id: unit.id } });
    return { companyId: company.id, warehouseId: warehouse.id, userId: user.id, productId: product.id, unitId: unit.id };
  });
  const actor = { empresaId: fixture.companyId, userId: fixture.userId };
  const input = createAdjustmentSchema.parse({ almacen_id: fixture.warehouseId.toString(), producto_id: fixture.productId.toString(), tipo: "AJUSTE_POSITIVO", cantidad: "2", motivo: "Prueba de concurrencia" });
  const sharedKey = randomUUID();
  const results = await Promise.all(Array.from({ length: 6 }, () => inventoryAdjustmentService.create(actor, input, sharedKey)));
  assert.equal(results.filter((result) => !result.replayed).length, 1);
  assert.equal(new Set(results.map((result) => result.data.ajuste_id)).size, 1);
  assert.equal(await prisma.ajuste_inventario.count({ where: { empresa_id: fixture.companyId } }), 1);
  assert.equal(await prisma.movimiento_inventario.count({ where: { producto_id: fixture.productId } }), 1);
  assert.equal(await prisma.sincronizacion_ecommerce_inventario.count({ where: { movimiento_inventario: { producto_id: fixture.productId } } }), 1);
  console.log("[OK] Seis peticiones iguales: un ajuste, un movimiento y un evento.");

  const otherInput = { ...input, cantidad: "3.000" };
  const conflicts = await Promise.allSettled(Array.from({ length: 3 }, () => inventoryAdjustmentService.create(actor, otherInput, sharedKey)));
  assert.ok(conflicts.every((result) => result.status === "rejected" && result.reason instanceof InventoryError && result.reason.code === "INVENTORY_IDEMPOTENCY_CONFLICT"));
  console.log("[OK] La misma clave con otro contenido no modifica las existencias.");

  const negativeInput = createAdjustmentSchema.parse({ ...input, almacen_id: input.almacen_id.toString(), producto_id: input.producto_id.toString(), tipo: "AJUSTE_NEGATIVO", cantidad: "1" });
  const outs = await Promise.allSettled(Array.from({ length: 6 }, () => inventoryAdjustmentService.create(actor, negativeInput, randomUUID())));
  assert.equal(outs.filter((result) => result.status === "fulfilled").length, 2);
  assert.ok(outs.filter((result) => result.status === "rejected").every((result) => result.reason instanceof InventoryError && result.reason.code === "INVENTORY_INSUFFICIENT_AVAILABLE"));
  const stock = await prisma.existencia.findUnique({ where: { producto_id_almacen_id: { producto_id: fixture.productId, almacen_id: fixture.warehouseId } } });
  assert.equal(stock?.cantidad.toFixed(3), "0.000");
  assert.equal(stock?.reservado.toFixed(3), "0.000");
  assert.equal(stock?.disponible?.toFixed(3), "0.000");
  assert.equal(await prisma.ajuste_inventario.count({ where: { empresa_id: fixture.companyId } }), 3);
  assert.equal(await prisma.movimiento_inventario.count({ where: { producto_id: fixture.productId } }), 3);
  assert.equal(await prisma.sincronizacion_ecommerce_inventario.count({ where: { movimiento_inventario: { producto_id: fixture.productId } } }), 3);
  console.log("[OK] Seis salidas sobre dos unidades: dos aplicadas, cuatro rechazadas, sin stock negativo.");
} catch (error) {
  process.exitCode = 1;
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.split(testUrl).join("[CONEXIÓN DE PRUEBA OCULTA]"));
} finally {
  try {
    if (fixture) {
      const own = fixture;
      await prisma.$transaction(async (tx) => {
        await tx.auditoria.deleteMany({ where: { usuario_id: own.userId } });
        await tx.ajuste_inventario.deleteMany({ where: { empresa_id: own.companyId } });
        await tx.movimiento_inventario.deleteMany({ where: { producto_id: own.productId } });
        await tx.empresa.delete({ where: { id: own.companyId } });
        await tx.unidad_medida.delete({ where: { id: own.unitId } });
      });
      console.log("[OK] Datos y eventos sintéticos eliminados de la base de pruebas.");
    }
  } catch (error) {
    process.exitCode = 1;
    console.error("La limpieza de la prueba no se completó.", error instanceof Error ? error.message : String(error));
  } finally { await prisma.$disconnect(); }
}
