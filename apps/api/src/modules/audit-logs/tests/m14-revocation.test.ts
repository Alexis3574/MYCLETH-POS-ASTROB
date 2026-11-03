import test from "node:test";
import assert from "node:assert/strict";

import {
  loadBranchAccess,
  canAccessBranch,
  allowedBranchWhere
} from "../../inventory/authorization/branch-access.js";

const actor = {
  empresaId: 1n,
  userId: 101n
};

let isAdmin = false;
let assignments = [10n, 20n];
let roleChecks = 0;
let assignmentChecks = 0;

const tx = {
  usuario_rol: {
    async findFirst(args: {
      where: Record<string, unknown>
    }) {
      roleChecks++;

      assert.equal(args.where.usuario_id, actor.userId);

      const user = args.where.usuario as
        Record<string, unknown>;

      const role = args.where.rol as
        Record<string, unknown>;

      assert.equal(user.empresa_id, actor.empresaId);
      assert.equal(user.activo, true);
      assert.equal(user.bloqueado, false);

      assert.deepEqual(user.empresa, { activo: true });
      assert.equal(role.codigo, "ADMIN");
      assert.equal(role.activo, true);

      return isAdmin
        ? { usuario_id: actor.userId }
        : null;
    }
  },

  usuario_sucursal: {
    async findMany(args: {
      where: Record<string, unknown>
    }) {
      assignmentChecks++;

      assert.equal(args.where.usuario_id, actor.userId);

      const user = args.where.usuario as
        Record<string, unknown>;

      const branch = args.where.sucursal as
        Record<string, unknown>;

      assert.equal(user.empresa_id, actor.empresaId);
      assert.equal(branch.empresa_id, actor.empresaId);
      assert.equal(branch.activo, true);

      return assignments.map(id => ({
        sucursal_id: id
      }));
    }
  }
} as unknown as Parameters<typeof loadBranchAccess>[0];

test("M14: autorizacion dinamica por sucursal", async t => {
  let initialRoles = 0;

  await t.test("Usuario autorizado en dos sucursales", async () => {
    const access = await loadBranchAccess(tx, actor);

    assert.equal(access.global, false);
    assert.deepEqual(access.sucursalIds, [10n, 20n]);

    assert.equal(canAccessBranch(access, 10n), true);
    assert.equal(canAccessBranch(access, 20n), true);
    assert.equal(canAccessBranch(access, 30n), false);

    assert.deepEqual(
      allowedBranchWhere(access),
      {
        empresa_id: 1n,
        id: { in: [10n, 20n] }
      }
    );

    initialRoles = roleChecks;
  });

  await t.test("Revocacion completa deniega acceso", async () => {
    assignments = [];

    const access = await loadBranchAccess(tx, actor);

    assert.equal(access.global, false);
    assert.deepEqual(access.sucursalIds, []);

    assert.equal(canAccessBranch(access, 10n), false);
    assert.equal(canAccessBranch(access, 20n), false);

    assert.deepEqual(
      allowedBranchWhere(access),
      {
        empresa_id: 1n,
        id: { in: [] }
      }
    );

    assert.ok(roleChecks > initialRoles);
  });

  await t.test("Reasignacion no recupera sucursal revocada", async () => {
    assignments = [20n];

    const access = await loadBranchAccess(tx, actor);

    assert.equal(access.global, false);

    assert.equal(canAccessBranch(access, 10n), false);
    assert.equal(canAccessBranch(access, 20n), true);

    assert.deepEqual(access.sucursalIds, [20n]);
  });

  await t.test("ADMIN activo tiene alcance global", async () => {
    isAdmin = true;
    assignments = [];

    const previousChecks = assignmentChecks;

    const access = await loadBranchAccess(tx, actor);

    assert.equal(access.global, true);
    assert.deepEqual(access.sucursalIds, []);

    assert.equal(canAccessBranch(access, 10n), true);
    assert.equal(canAccessBranch(access, 20n), true);

    assert.deepEqual(
      allowedBranchWhere(access),
      { empresa_id: 1n }
    );

    assert.equal(assignmentChecks, previousChecks);
  });

  await t.test("Revocacion ADMIN elimina alcance global", async () => {
    isAdmin = false;
    assignments = [];

    const access = await loadBranchAccess(tx, actor);

    assert.equal(access.global, false);
    assert.deepEqual(access.sucursalIds, []);

    assert.equal(canAccessBranch(access, 10n), false);

    assert.deepEqual(
      allowedBranchWhere(access),
      {
        empresa_id: 1n,
        id: { in: [] }
      }
    );
  });

  assert.ok(roleChecks >= 5);
  assert.ok(assignmentChecks >= 4);

  console.log({
    verificaciones_rol: roleChecks,
    verificaciones_asignaciones: assignmentChecks,
    estado_final: "ACCESO_DENEGADO"
  });
});
