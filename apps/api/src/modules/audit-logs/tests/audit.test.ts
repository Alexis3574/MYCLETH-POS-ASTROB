import test from "node:test";
import assert from "node:assert/strict";

import {
  auditIdSchema,
  auditListSchema
} from "../validators/audit.schema.js";

import {
  redactAuditPayload
} from "../utils/audit-redaction.js";

test("M14: acepta identificadores bigint validos", () => {
  const result = auditIdSchema.parse("9223372036854775807");
  assert.equal(result, 9223372036854775807n);
});

test("M14: rechaza IDs invalidos", () => {
  for (const id of ["0", "-1", "abc", "9223372036854775808"]) {
    assert.equal(auditIdSchema.safeParse(id).success, false);
  }
});

test("M14: aplica paginacion predeterminada", () => {
  const result = auditListSchema.parse({});
  assert.equal(result.page, 1);
  assert.equal(result.limit, 20);
});

test("M14: limita paginas y resultados", () => {
  assert.equal(
    auditListSchema.safeParse({ limit: "101" }).success,
    false
  );
  assert.equal(
    auditListSchema.safeParse({ page: "0" }).success,
    false
  );
});

test("M14: rechaza intervalos de fechas invertidos", () => {
  assert.equal(
    auditListSchema.safeParse({
      fecha_desde: "2026-11-02",
      fecha_hasta: "2026-10-01"
    }).success,
    false
  );
});

test("M14: rechaza fechas calendario inexistentes", () => {
  assert.equal(
    auditListSchema.safeParse({
      fecha_desde: "2026-02-30"
    }).success,
    false
  );
});

test("M14: oculta campos sensibles de auditoria", () => {
  const result = redactAuditPayload("venta", {
    folio: "V-001",
    estado: "COMPLETADA",
    password_hash: "SECRETO",
    token: "SECRETO",
    cliente: {
      email: "privado@example.com"
    }
  });

  assert.deepEqual(result, {
    folio: "V-001",
    estado: "COMPLETADA"
  });
});

test("M14: deniega campos de entidades desconocidas", () => {
  assert.deepEqual(
    redactAuditPayload("entidad_desconocida", {
      secreto: "valor",
      estado: "ACTIVO"
    }),
    {}
  );
});
