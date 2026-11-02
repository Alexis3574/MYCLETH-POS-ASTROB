import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "../../src/generated/prisma/client.js";
import { allowedBranchWhere, canAccessBranch, loadBranchAccess } from "../../src/modules/inventory/authorization/branch-access.js";

type Query = { where: Record<string, unknown> };
const actor = { empresaId: 10n, userId: 20n };
function fakeTx({ admin = false, ids = [] as bigint[] } = {}) {
  const calls: Query[] = [];
  const tx = {
    usuario_rol: { findFirst: async (q: Query) => { calls.push(q); return admin ? { usuario_id: actor.userId } : null; } },
    usuario_sucursal: { findMany: async (q: Query) => { calls.push(q); return ids.map(sucursal_id => ({ sucursal_id })); } },
  } as unknown as Prisma.TransactionClient;
  return { tx, calls };
}

test("ADMIN activo tiene acceso global solo dentro de su empresa", async () => {
  const { tx, calls } = fakeTx({ admin: true });
  const access = await loadBranchAccess(tx, actor);
  assert.equal(access.global, true);
  assert.deepEqual(allowedBranchWhere(access), { empresa_id: 10n });
  assert.equal(canAccessBranch(access, 999n), true);
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0]!.where as any).rol, { codigo: "ADMIN", activo: true });
});

test("Usuario con sucursal asignada solo accede a esa sucursal", async () => {
  const { tx, calls } = fakeTx({ ids: [30n] });
  const access = await loadBranchAccess(tx, actor);
  assert.equal(access.global, false);
  assert.equal(canAccessBranch(access, 30n), true);
  assert.equal(canAccessBranch(access, 40n), false);
  assert.deepEqual(allowedBranchWhere(access), { empresa_id: 10n, id: { in: [30n] } });
  const where = calls[1]!.where as any;
  assert.deepEqual(where.sucursal, { empresa_id: 10n, activo: true });
  assert.equal(where.usuario_id, actor.userId);
});

test("Sin sucursales se deniega por defecto (no se amplía el acceso)", async () => {
  const { tx } = fakeTx();
  const access = await loadBranchAccess(tx, actor);
  assert.deepEqual(access.sucursalIds, []);
  assert.equal(canAccessBranch(access, 30n), false);
  assert.deepEqual(allowedBranchWhere(access), { empresa_id: 10n, id: { in: [] } });
});

test("Inventario filtra almacenes y transferencias oculta extremos no asignados", async () => {
  const { inventoryContextRepository } = await import("../../src/modules/inventory/repositories/inventory-context.repository.js");
  const { transferRepository } = await import("../../src/modules/transfers/repositories/transfer.repository.js");
  const access = { empresaId: 10n, global: false, sucursalIds: [30n] };
  const whQueries: Array<Record<string, unknown>> = [];
  const transferQueries: Array<Record<string, unknown>> = [];
  const tx = {
    almacen: {
      count: async (q: any) => { whQueries.push(q); return 0; },
      findMany: async (q: any) => { whQueries.push(q); return []; },
    },
    transferencia_almacen: {
      count: async (q: any) => { transferQueries.push(q); return 0; },
      findMany: async (q: any) => { transferQueries.push(q); return []; },
    },
  } as unknown as Prisma.TransactionClient;
  await inventoryContextRepository.listWarehouses(tx, access, { page: 1, limit: 10 } as any);
  assert.deepEqual((whQueries[0]!.where as any).sucursal, { empresa_id: 10n, id: { in: [30n] } });
  await transferRepository.list(tx, access, { page: 1, limit: 10 } as any);
  const constraints = (transferQueries[0]!.where as any).AND;
  assert.equal(constraints.length, 2);
  const origin = constraints[0].almacen_transferencia_almacen_almacen_origen_idToalmacen;
  const destination = constraints[1].almacen_transferencia_almacen_almacen_destino_idToalmacen;
  assert.deepEqual(origin.sucursal, { empresa_id: 10n, id: { in: [30n] } });
  assert.deepEqual(destination.sucursal, { empresa_id: 10n, id: { in: [30n] } });
});

test("Consulta explícita de almacén de sucursal ajena responde 404", async () => {
  const { validateAuthorizedWarehouse } = await import("../../src/modules/inventory/validators/inventory-context.validator.js");
  const tx = {
    almacen: { findFirst: async () => ({ id: 123n, sucursal: { id: 40n } }) },
  } as unknown as Prisma.TransactionClient;
  const access = { empresaId: 10n, global: false, sucursalIds: [30n] };
  await assert.rejects(() => validateAuthorizedWarehouse(tx, access, 123n),
    (err: any) => err.status === 404 && err.code === "INVENTORY_WAREHOUSE_NOT_FOUND");
  const adminAccess = { empresaId: 10n, global: true, sucursalIds: [] };
  const warehouse = await validateAuthorizedWarehouse(tx, adminAccess, 123n);
  assert.equal(warehouse.id, 123n);
});

test("Movimientos sin almacen_id siguen filtrados por sucursales", async () => {
  const { inventoryMovementRepository } = await import("../../src/modules/inventory/repositories/inventory-movement.repository.js");
  const seen: any[] = [];
  const tx = { movimiento_inventario: {
    count: async (q: any) => { seen.push(q.where); return 0; },
    findMany: async (q: any) => { seen.push(q.where); return []; },
  } } as unknown as Prisma.TransactionClient;
  const access = { empresaId: 10n, global: false, sucursalIds: [30n] };
  const result = await inventoryMovementRepository.list(tx, 10n, { page: 1, limit: 10 } as any, access);
  assert.equal(result.total, 0);
  assert.deepEqual(seen[0]!.almacen.sucursal, { empresa_id: 10n, id: { in: [30n] } });
  assert.deepEqual(seen[1]!.almacen.sucursal, { empresa_id: 10n, id: { in: [30n] } });
});

test("Detalle de transferencia también comprueba origen y destino", async () => {
  const { transferRepository } = await import("../../src/modules/transfers/repositories/transfer.repository.js");
  let where: any;
  const tx = { transferencia_almacen: { findFirst: async (q: any) => { where = q.where; return null; } } } as unknown as Prisma.TransactionClient;
  const access = { empresaId: 10n, global: false, sucursalIds: [30n] };
  assert.equal(await transferRepository.findVisible(tx, access, 50n), null);
  assert.equal(where.empresa_id, 10n);
  assert.equal(where.id, 50n);
  assert.deepEqual(where.AND[0].almacen_transferencia_almacen_almacen_origen_idToalmacen.sucursal.id, { in: [30n] });
  assert.deepEqual(where.AND[1].almacen_transferencia_almacen_almacen_destino_idToalmacen.sucursal.id, { in: [30n] });
});
