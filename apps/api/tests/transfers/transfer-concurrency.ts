import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFixture, deleteFixture, testRuntime } from "./support/database-fixture.js";
import { createTransferSchema } from "../../src/modules/transfers/transfer.schema.js";

test("dos reintentos simultáneos crean un documento y un único par de movimientos", async () => {
  const runtime = await testRuntime();
  const fixture = await runtime.prisma.$transaction((tx) => createFixture(tx));
  try {
    const input = createTransferSchema.parse({ almacen_origen_id: fixture.originId.toString(), almacen_destino_id: fixture.destinationId.toString(),
      detalles: [{ producto_id: fixture.products[0]!.toString(), cantidad: "1.500" }] });
    const key = randomUUID();
    const created = await Promise.all([runtime.transferWriteService.create(fixture.actor, input, key), runtime.transferWriteService.create(fixture.actor, input, key)]);
    assert.equal(created[0]!.data.transferencia.id, created[1]!.data.transferencia.id);
    assert.equal(created.filter((result) => result.replayed).length, 1);
    const id = BigInt(created[0]!.data.transferencia.id);
    const completeKey = randomUUID();
    const completed = await Promise.all([runtime.transferWriteService.complete(fixture.actor, id, completeKey), runtime.transferWriteService.complete(fixture.actor, id, completeKey)]);
    assert.equal(completed.filter((result) => result.replayed).length, 1);
    assert.deepEqual(completed[0]!.data, completed[1]!.data);
    assert.equal(await runtime.prisma.movimiento_inventario.count({ where: { documento_tipo: "TRANSFERENCIA", documento_id: id } }), 2);
  } finally {
    await runtime.prisma.$transaction((tx) => deleteFixture(tx, fixture), { timeout: 30000 });
    await runtime.prisma.$disconnect();
  }
});

test("dos transferencias compiten por el disponible sin consumir reservas", async () => {
  const runtime = await testRuntime();
  const fixture = await runtime.prisma.$transaction((tx) => createFixture(tx));
  try {
    const input = createTransferSchema.parse({ almacen_origen_id: fixture.originId.toString(), almacen_destino_id: fixture.destinationId.toString(),
      detalles: [{ producto_id: fixture.products[0]!.toString(), cantidad: "4.000" }] });
    const first = await runtime.transferWriteService.create(fixture.actor, input, randomUUID());
    const second = await runtime.transferWriteService.create(fixture.actor, input, randomUUID());
    const results = await Promise.allSettled([
      runtime.transferWriteService.complete(fixture.actor, BigInt(first.data.transferencia.id), randomUUID()),
      runtime.transferWriteService.complete(fixture.actor, BigInt(second.data.transferencia.id), randomUUID()),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const failure = results.find((result) => result.status === "rejected");
    assert.ok(failure && failure.status === "rejected");
    assert.equal(failure.reason.code, "TRANSFER_INSUFFICIENT_AVAILABLE");
    const stock = await runtime.prisma.existencia.findUniqueOrThrow({ where: { producto_id_almacen_id: { producto_id: fixture.products[0]!, almacen_id: fixture.originId } } });
    assert.equal(stock.cantidad.toFixed(3), "6.000");
    assert.equal(stock.reservado.toFixed(3), "4.000");
    assert.equal(stock.disponible?.toFixed(3), "2.000");
  } finally {
    await runtime.prisma.$transaction((tx) => deleteFixture(tx, fixture), { timeout: 30000 });
    await runtime.prisma.$disconnect();
  }
});

test("transferencias opuestas con detalles invertidos mantienen cantidades y orden de bloqueos", async () => {
  const runtime = await testRuntime();
  const fixture = await runtime.prisma.$transaction((tx) => createFixture(tx));
  try {
    const details = fixture.products.map((id) => ({ producto_id: id.toString(), cantidad: "1.000" }));
    const first = await runtime.transferWriteService.create(fixture.actor, createTransferSchema.parse({ almacen_origen_id: fixture.originId.toString(),
      almacen_destino_id: fixture.destinationId.toString(), detalles: details }), randomUUID());
    const second = await runtime.transferWriteService.create(fixture.actor, createTransferSchema.parse({ almacen_origen_id: fixture.destinationId.toString(),
      almacen_destino_id: fixture.originId.toString(), detalles: [...details].reverse() }), randomUUID());
    await Promise.all([
      runtime.transferWriteService.complete(fixture.actor, BigInt(first.data.transferencia.id), randomUUID()),
      runtime.transferWriteService.complete(fixture.actor, BigInt(second.data.transferencia.id), randomUUID()),
    ]);
    for (const id of fixture.products) {
      const origin = await runtime.prisma.existencia.findUniqueOrThrow({ where: { producto_id_almacen_id: { producto_id: id, almacen_id: fixture.originId } } });
      const destination = await runtime.prisma.existencia.findUniqueOrThrow({ where: { producto_id_almacen_id: { producto_id: id, almacen_id: fixture.destinationId } } });
      assert.equal(origin.cantidad.toFixed(3), "10.000");
      assert.equal(destination.cantidad.toFixed(3), "2.000");
      assert.equal(origin.reservado.toFixed(3), "4.000");
    }
  } finally {
    await runtime.prisma.$transaction((tx) => deleteFixture(tx, fixture), { timeout: 30000 });
    await runtime.prisma.$disconnect();
  }
});
