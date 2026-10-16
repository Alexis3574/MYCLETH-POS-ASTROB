import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFixture, testRuntime } from "./support/database-fixture.js";
import { createTransferSchema } from "../../src/modules/transfers/transfer.schema.js";

test("confirmación, costo, reservas e idempotencia dentro de una transacción revertida", async () => {
  const runtime = await testRuntime();
  const tag = randomUUID();
  const rollback = new Error("TRANSFER_TEST_ROLLBACK");
  try {
    await assert.rejects(runtime.prisma.$transaction(async (tx) => {
      const fixture = await createFixture(tx, tag);
      const input = createTransferSchema.parse({ almacen_origen_id: fixture.originId.toString(), almacen_destino_id: fixture.destinationId.toString(),
        detalles: fixture.products.map((id) => ({ producto_id: id.toString(), cantidad: "2.000" })) });
      const createKey = randomUUID();
      const completeKey = randomUUID();
      const created = await runtime.createTransferInTransaction(tx, fixture.actor, input, createKey);
      const id = BigInt(created.data.transferencia.id);
      const completed = await runtime.completeTransferInTransaction(tx, fixture.actor, id, completeKey);
      const replay = await runtime.completeTransferInTransaction(tx, fixture.actor, id, completeKey);
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.data, completed.data);
      assert.equal(completed.data.transferencia.estado, "COMPLETADA");
      assert.equal(completed.data.movimientos.length, 4);
      assert.equal(completed.data.ecommerce.eventos_creados, 0);
      for (const change of completed.data.existencias) {
        assert.equal(change.origen.despues.cantidad, "8.000");
        assert.equal(change.origen.despues.reservado, "4.000");
        assert.equal(change.destino.despues.cantidad, "4.000");
        assert.equal(change.destino.despues.costo_promedio, "21.2500");
        assert.equal(change.costo_unitario, "12.5000");
      }
      assert.equal(await tx.operacion_transferencia.count({ where: { transferencia_id: id } }), 2);
      assert.equal(await tx.auditoria.count({ where: { usuario_id: fixture.actor.userId } }), 2);
      assert.equal(await tx.sincronizacion_ecommerce_inventario.count({ where: { movimiento_inventario: { producto_id: { in: fixture.products } } } }), 0);
      await assert.rejects(runtime.completeTransferInTransaction(tx, fixture.actor, id, randomUUID()), { code: "TRANSFER_INVALID_STATE" });
      await assert.rejects(runtime.createTransferInTransaction(tx, fixture.actor, { ...input, observaciones: "Otro contenido" }, createKey), { code: "TRANSFER_IDEMPOTENCY_CONFLICT" });
      throw rollback;
    }, { timeout: 30000 }), (error) => error === rollback);
    assert.equal(await runtime.prisma.empresa.count({ where: { razon_social: `TRANSFERS_TEST_${tag}` } }), 0);
  } finally { await runtime.prisma.$disconnect(); }
});

test("fallo al entrar el segundo producto revierte el documento, los movimientos y las existencias", async () => {
  const runtime = await testRuntime();
  const tag = randomUUID();
  let reachedConfirmation = false;
  try {
    await assert.rejects(runtime.prisma.$transaction(async (tx) => {
      const fixture = await createFixture(tx, tag);
      const created = await runtime.createTransferInTransaction(tx, fixture.actor, createTransferSchema.parse({
        almacen_origen_id: fixture.originId.toString(), almacen_destino_id: fixture.destinationId.toString(),
        detalles: fixture.products.map((id) => ({ producto_id: id.toString(), cantidad: "1.000" })),
      }), randomUUID());
      await tx.$executeRawUnsafe(`CREATE FUNCTION pg_temp.transfer_test_fail() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN IF NEW.producto_id = ${fixture.products[1]!.toString()} AND NEW.tipo = 'TRANSFERENCIA_ENTRADA' THEN
        RAISE EXCEPTION 'TRANSFER_TEST_SECOND_PRODUCT_FAILURE'; END IF; RETURN NEW; END; $body$`);
      await tx.$executeRawUnsafe("CREATE TRIGGER trg_transfer_test_fail AFTER INSERT ON pos.movimiento_inventario FOR EACH ROW EXECUTE FUNCTION pg_temp.transfer_test_fail()");
      reachedConfirmation = true;
      await runtime.completeTransferInTransaction(tx, fixture.actor, BigInt(created.data.transferencia.id), randomUUID());
    }, { timeout: 30000 }), /TRANSFER_TEST_SECOND_PRODUCT_FAILURE/);
    assert.equal(reachedConfirmation, true);
    assert.equal(await runtime.prisma.empresa.count({ where: { razon_social: `TRANSFERS_TEST_${tag}` } }), 0);
    const triggers = await runtime.prisma.$queryRaw<Array<{ present: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'trg_transfer_test_fail') AS present`;
    assert.equal(triggers[0]?.present, false);
  } finally { await runtime.prisma.$disconnect(); }
});

test("aislamiento entre empresas y cancelación idempotente sin movimientos", async () => {
  const runtime = await testRuntime();
  const rollback = new Error("TRANSFER_TEST_ROLLBACK");
  try {
    await assert.rejects(runtime.prisma.$transaction(async (tx) => {
      const a = await createFixture(tx);
      const b = await createFixture(tx);
      const input = createTransferSchema.parse({ almacen_origen_id: a.originId.toString(), almacen_destino_id: a.destinationId.toString(),
        detalles: [{ producto_id: a.products[0]!.toString(), cantidad: "1.000" }] });
      await assert.rejects(runtime.createTransferInTransaction(tx, a.actor, { ...input, almacen_destino_id: b.destinationId }, randomUUID()), { code: "TRANSFER_WAREHOUSE_NOT_FOUND" });
      const created = await runtime.createTransferInTransaction(tx, a.actor, input, randomUUID());
      const id = BigInt(created.data.transferencia.id);
      await assert.rejects(runtime.completeTransferInTransaction(tx, b.actor, id, randomUUID()), { code: "TRANSFER_NOT_FOUND" });
      const key = randomUUID();
      const canceled = await runtime.cancelTransferInTransaction(tx, a.actor, id, key, "Prueba de cancelación");
      const replay = await runtime.cancelTransferInTransaction(tx, a.actor, id, key, "Prueba de cancelación");
      assert.equal(canceled.data.transferencia.estado, "CANCELADA");
      assert.deepEqual(replay.data, canceled.data);
      assert.equal(replay.replayed, true);
      assert.equal(canceled.data.movimientos.length, 0);
      await assert.rejects(runtime.completeTransferInTransaction(tx, a.actor, id, randomUUID()), { code: "TRANSFER_INVALID_STATE" });
      throw rollback;
    }, { timeout: 30000 }), (error) => error === rollback);
  } finally { await runtime.prisma.$disconnect(); }
});
