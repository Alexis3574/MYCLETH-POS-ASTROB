/** Pruebas con datos sintéticos dentro de una transacción que SIEMPRE se revierte. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma.js";
import { createAdjustmentSchema, kardexQuerySchema, movementsQuerySchema, stockQuerySchema } from "../../src/modules/inventory/inventory.schema.js";
import { adjustInTransaction } from "../../src/modules/inventory/services/inventory-adjustment.service.js";
import { getKardexInTransaction } from "../../src/modules/inventory/services/inventory-query.service.js";
import { inventoryMovementRepository } from "../../src/modules/inventory/repositories/inventory-movement.repository.js";
import { inventoryStockRepository } from "../../src/modules/inventory/repositories/inventory-stock.repository.js";
import { InventoryError } from "../../src/modules/inventory/errors/inventory.errors.js";

const rollback = new Error("INVENTORY_TEST_ROLLBACK");
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const companyName = `INVTEST_${suffix}`;
const movementIds: bigint[] = [];
const adjustmentIds: bigint[] = [];
let checks = 0;
let reachedRollback = false;

function passed(label: string) { checks++; console.log(`[OK] ${label}`); }
function domainError(expected: string) {
  return (error: unknown) => error instanceof InventoryError && error.code === expected;
}

try {
  try {
    await prisma.$transaction(async (tx) => {
      const companyA = await tx.empresa.create({ data: { razon_social: companyName, nombre_comercial: companyName } });
      const companyB = await tx.empresa.create({ data: { razon_social: `${companyName}_B`, nombre_comercial: `${companyName}_B` } });
      const branchA = await tx.sucursal.create({ data: { empresa_id: companyA.id, codigo: "TEST", nombre: "Sucursal de prueba" } });
      const branchB = await tx.sucursal.create({ data: { empresa_id: companyB.id, codigo: "TEST", nombre: "Otra empresa" } });
      const warehouseA = await tx.almacen.create({ data: { sucursal_id: branchA.id, codigo: "TEST", nombre: "Almacén de prueba" } });
      const warehouseB = await tx.almacen.create({ data: { sucursal_id: branchB.id, codigo: "TEST", nombre: "Otro almacén" } });
      const userA = await tx.usuario.create({ data: { empresa_id: companyA.id, username: `invtest_${suffix}`, password_hash: "synthetic-test-only", nombre: "Prueba" } });
      const unit = await tx.unidad_medida.create({ data: { codigo: `IT_${suffix}`, nombre: "Unidad de prueba", permite_decimales: true } });
      const integerUnit = await tx.unidad_medida.create({ data: { codigo: `IE_${suffix}`, nombre: "Pieza de prueba", permite_decimales: false } });
      const productA = await tx.producto.create({ data: { empresa_id: companyA.id, sku: `IT_${suffix}`, nombre: "Producto de prueba", codigo_barras: `INVTEST-${suffix}`, unidad_medida_id: unit.id } });
      const productB = await tx.producto.create({ data: { empresa_id: companyB.id, sku: "IT", nombre: "Producto ajeno", unidad_medida_id: unit.id } });
      const actor = { empresaId: companyA.id, userId: userA.id };
      const body = (changes: Record<string, unknown> = {}) => createAdjustmentSchema.parse({ almacen_id: warehouseA.id.toString(), producto_id: productA.id.toString(), tipo: "AJUSTE_POSITIVO", cantidad: "5", costo_unitario: "10", motivo: "Conteo de prueba", ...changes });
      const key = randomUUID();

      const first = await adjustInTransaction(tx, actor, body(), key);
      assert.equal(first.replayed, false);
      assert.equal(first.data.existencia_despues.cantidad, "5.000");
      assert.equal(first.data.existencia_despues.disponible, "5.000");
      assert.equal(first.data.existencia_despues.costo_promedio, "10.0000");
      movementIds.push(BigInt(first.data.movimiento_id));
      adjustmentIds.push(BigInt(first.data.ajuste_id));
      passed("Entrada inicial aplicada una vez por el trigger");

      const replay = await adjustInTransaction(tx, actor, body({ cantidad: "5.000", costo_unitario: "10.0000" }), key);
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.data, first.data);
      assert.equal(await tx.movimiento_inventario.count({ where: { producto_id: productA.id } }), 1);
      assert.equal(await tx.ajuste_inventario.count({ where: { empresa_id: companyA.id } }), 1);
      assert.equal(await tx.sincronizacion_ecommerce_inventario.count({ where: { movimiento_inventario_id: BigInt(first.data.movimiento_id) } }), 1);
      assert.equal(await tx.auditoria.count({ where: { tabla: "ajuste_inventario", registro_id: BigInt(first.data.ajuste_id) } }), 1);
      passed("Reintento sin duplicar movimiento, ajuste, evento ni auditoría");

      await assert.rejects(() => adjustInTransaction(tx, actor, body({ cantidad: "6" }), key), domainError("INVENTORY_IDEMPOTENCY_CONFLICT"));
      passed("Misma clave con contenido diferente produce conflicto");

      await tx.$executeRaw`UPDATE pos.existencia SET reservado = 2 WHERE producto_id = ${productA.id} AND almacen_id = ${warehouseA.id}`;
      await assert.rejects(() => adjustInTransaction(tx, actor, body({ tipo: "AJUSTE_NEGATIVO", cantidad: "4", costo_unitario: null }), randomUUID()), domainError("INVENTORY_INSUFFICIENT_AVAILABLE"));
      const negative = await adjustInTransaction(tx, actor, body({ tipo: "AJUSTE_NEGATIVO", cantidad: "3", costo_unitario: null }), randomUUID());
      assert.equal(negative.data.existencia_despues.cantidad, "2.000");
      assert.equal(negative.data.existencia_despues.reservado, "2.000");
      assert.equal(negative.data.existencia_despues.disponible, "0.000");
      const negativeSync = await tx.sincronizacion_ecommerce_inventario.findUnique({ where: { movimiento_inventario_id: BigInt(negative.data.movimiento_id) } });
      assert.equal(negativeSync?.adjustment, -3);
      movementIds.push(BigInt(negative.data.movimiento_id));
      adjustmentIds.push(BigInt(negative.data.ajuste_id));
      passed("Salida limitada a disponible, sin consumir reservado; evento negativo");

      const priced = await adjustInTransaction(tx, actor, body({ cantidad: "1", costo_unitario: "20" }), randomUUID());
      assert.equal(priced.data.existencia_despues.costo_promedio, "13.3333");
      movementIds.push(BigInt(priced.data.movimiento_id));
      adjustmentIds.push(BigInt(priced.data.ajuste_id));
      passed("Costo promedio calculado por el trigger");

      const local = await adjustInTransaction(tx, actor, body({ cantidad: "0.500", costo_unitario: null, sincronizar_ecommerce: false }), randomUUID());
      assert.equal(local.data.existencia_despues.cantidad, "3.500");
      assert.equal(local.data.sincronizacion.evento_id, null);
      assert.equal(await tx.sincronizacion_ecommerce_inventario.count({ where: { movimiento_inventario_id: BigInt(local.data.movimiento_id) } }), 0);
      movementIds.push(BigInt(local.data.movimiento_id));
      adjustmentIds.push(BigInt(local.data.ajuste_id));
      passed("Decimal local explícito, sin evento fraccionario");

      await assert.rejects(() => adjustInTransaction(tx, actor, body({ almacen_id: warehouseB.id.toString() }), randomUUID()), domainError("INVENTORY_WAREHOUSE_NOT_FOUND"));
      await assert.rejects(() => adjustInTransaction(tx, actor, body({ producto_id: productB.id.toString() }), randomUUID()), domainError("INVENTORY_PRODUCT_NOT_FOUND"));
      passed("Aislamiento entre empresas para almacén y producto");

      const noBarcode = await tx.producto.create({ data: { empresa_id: companyA.id, sku: `NB_${suffix}`, nombre: "Sin código de barras", unidad_medida_id: unit.id } });
      await assert.rejects(() => adjustInTransaction(tx, actor, body({ producto_id: noBarcode.id.toString() }), randomUUID()), domainError("INVENTORY_BARCODE_REQUIRED"));
      const integerProduct = await tx.producto.create({ data: { empresa_id: companyA.id, sku: `IP_${suffix}`, nombre: "Pieza", unidad_medida_id: integerUnit.id } });
      await assert.rejects(() => adjustInTransaction(tx, actor, body({ producto_id: integerProduct.id.toString(), cantidad: "0.500", sincronizar_ecommerce: false }), randomUUID()), domainError("INVENTORY_UNIT_REQUIRES_INTEGER"));
      const inactive = await tx.producto.create({ data: { empresa_id: companyA.id, sku: `IA_${suffix}`, nombre: "Inactivo", unidad_medida_id: unit.id, activo: false } });
      await assert.rejects(() => adjustInTransaction(tx, actor, body({ producto_id: inactive.id.toString(), sincronizar_ecommerce: false }), randomUUID()), domainError("INVENTORY_PRODUCT_INACTIVE"));
      const service = await tx.producto.create({ data: { empresa_id: companyA.id, sku: `SV_${suffix}`, nombre: "Servicio", unidad_medida_id: unit.id, tipo: "SERVICIO", controla_inventario: false } });
      await assert.rejects(() => adjustInTransaction(tx, actor, body({ producto_id: service.id.toString(), sincronizar_ecommerce: false }), randomUUID()), domainError("PRODUCT_DOES_NOT_CONTROL_INVENTORY"));
      passed("Unidad, estado, tipo de producto y requisito de código de barras");

      const stockResult = await inventoryStockRepository.list(tx, companyA.id, stockQuerySchema.parse({ almacen_id: warehouseA.id.toString() }));
      assert.equal(stockResult.rows.some((row) => row.id === productB.id), false);
      assert.equal(stockResult.rows.some((row) => row.id === service.id), false);
      assert.equal(stockResult.rows.find((row) => row.id === noBarcode.id)?.existencia.length, 0);
      const moveResult = await inventoryMovementRepository.list(tx, companyA.id, movementsQuerySchema.parse({ producto_id: productA.id.toString(), tipo: "AJUSTE_NEGATIVO" }));
      assert.equal(moveResult.total, 1);
      passed("Consultas de existencias y movimientos con filtros de empresa");

      const historical = await tx.producto.create({ data: { empresa_id: companyA.id, sku: `KH_${suffix}`, nombre: "Kardex", unidad_medida_id: unit.id } });
      await tx.$executeRaw`INSERT INTO pos.existencia (producto_id, almacen_id, cantidad, reservado, costo_promedio) VALUES (${historical.id}, ${warehouseA.id}, 10, 0, 5)`;
      const dates = ["2026-10-01T08:00:00Z", "2026-10-01T08:00:00Z", "2026-10-02T08:00:00Z"];
      const quantities = ["5", "2", "1"];
      for (let i = 0; i < 3; i++) {
        const movement = await tx.movimiento_inventario.create({ data: { producto_id: historical.id, almacen_id: warehouseA.id, usuario_id: userA.id, tipo: i === 1 ? "SALIDA" : "ENTRADA", cantidad: quantities[i]!, motivo: "Historial sintético", fecha: new Date(dates[i]!) } });
        movementIds.push(movement.id);
      }
      const historyQuery = { almacen_id: warehouseA.id.toString(), producto_id: historical.id.toString(), limit: "1" };
      const firstPage = await getKardexInTransaction(tx, companyA.id, kardexQuerySchema.parse(historyQuery));
      assert.equal(firstPage.resumen.saldo_base_reconstruido, "10.000");
      assert.equal(firstPage.resumen.saldo_final_periodo, "14.000");
      assert.equal(firstPage.data[0]?.saldo_despues, "15.000");
      const secondPage = await getKardexInTransaction(tx, companyA.id, kardexQuerySchema.parse({ ...historyQuery, page: "2" }));
      assert.equal(secondPage.data[0]?.saldo_antes, "15.000");
      assert.equal(secondPage.data[0]?.saldo_despues, "13.000");
      const period = await getKardexInTransaction(tx, companyA.id, kardexQuerySchema.parse({ ...historyQuery, fecha_desde: "2026-10-02T00:00:00Z" }));
      assert.equal(period.resumen.saldo_inicial_periodo, "13.000");
      assert.equal(period.resumen.saldo_final_periodo, "14.000");
      assert.equal(period.pagination.total, 1);
      passed("Kardex con saldo inicial, fechas, empate de fechas y paginación");

      reachedRollback = true;
      throw rollback;
    }, { isolationLevel: "ReadCommitted", timeout: 60000, maxWait: 10000 });
  } catch (error) { if (error !== rollback) throw error; }

  assert.equal(reachedRollback, true);
  assert.equal(await prisma.empresa.count({ where: { razon_social: { startsWith: companyName } } }), 0);
  assert.equal(await prisma.movimiento_inventario.count({ where: { id: { in: movementIds } } }), 0);
  assert.equal(await prisma.sincronizacion_ecommerce_inventario.count({ where: { movimiento_inventario_id: { in: movementIds } } }), 0);
  assert.equal(await prisma.ajuste_inventario.count({ where: { id: { in: adjustmentIds } } }), 0);
  assert.equal(await prisma.auditoria.count({ where: { tabla: "ajuste_inventario", registro_id: { in: adjustmentIds } } }), 0);
  passed("Rollback comprobado: sin datos sintéticos ni eventos confirmados");
  console.log(`\n${checks} comprobaciones correctas. No se hicieron llamadas al Ecommerce.`);
  console.log("Productos/Catálogo sigue pendiente de sus pruebas funcionales.");
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
} finally { await prisma.$disconnect(); }
