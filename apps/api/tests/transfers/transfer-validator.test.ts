import test from "node:test";
import assert from "node:assert/strict";
import { requireDraft, validateTransferQuantity } from "../../src/modules/transfers/validators/transfer.validator.js";
import { TransferError, retryableTransferError, translateTransferError } from "../../src/modules/transfers/errors/transfer.errors.js";

const stock = { cantidad: "10.000", reservado: "4.000", disponible: "6.000", costo_promedio: "12.0000" };
const empty = { cantidad: "0.000", reservado: "0.000", disponible: "0.000", costo_promedio: "0.0000" };
const code = (expected: string) => (error: unknown) => error instanceof TransferError && error.code === expected;

test("usa disponible y deja intacto lo reservado", () => {
  assert.doesNotThrow(() => validateTransferQuantity("6.000", false, stock, empty));
  assert.throws(() => validateTransferQuantity("6.001", true, stock, empty), code("TRANSFER_INSUFFICIENT_AVAILABLE"));
  assert.throws(() => validateTransferQuantity("1.500", false, stock, empty), code("TRANSFER_UNIT_REQUIRES_INTEGER"));
});

test("protege rango de destino y estados terminales", () => {
  const full = { ...stock, cantidad: "99999999999.999" };
  assert.throws(() => validateTransferQuantity("0.001", true, stock, full), code("TRANSFER_STOCK_LIMIT"));
  assert.doesNotThrow(() => requireDraft("BORRADOR"));
  assert.throws(() => requireDraft("COMPLETADA"), code("TRANSFER_INVALID_STATE"));
  assert.throws(() => requireDraft("CANCELADA"), code("TRANSFER_INVALID_STATE"));
});

test("reconoce errores de PostgreSQL envueltos por Prisma y limita los reintentos a conflictos", () => {
  assert.equal(retryableTransferError({ code: "P2034" }), true);
  assert.equal(retryableTransferError({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "40P01" } } } }), true);
  assert.equal(retryableTransferError({ code: "P2010", meta: { code: "P0001" } }), false);
  const error = translateTransferError({ code: "P2010", meta: { message: "TRANSFER_INSUFFICIENT_AVAILABLE" } });
  assert.equal(error instanceof TransferError && error.status, 409);
});
