import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../../src/generated/prisma/client.js";

import {
  createCustomerSchema,
  updateCustomerSchema,
  customerListSchema,
  createCustomerAddressSchema,
  updateCustomerAddressSchema,
} from "../../src/modules/customers/customer.schema.ts";

import {
  jsonSafe,
  idFromRoute,
  isUniqueViolation,
} from "../../src/modules/customers/customer.utils.ts";

import {
  CustomerError,
  customerError,
} from "../../src/modules/customers/customer.errors.ts";

const customer = {
  codigo: "CLI-001",
  nombre: "Cliente de prueba",
};

test("creación válida de cliente", () => {
  const result = createCustomerSchema.parse(customer);
  assert.equal(result.codigo, "CLI-001");
  assert.equal(result.nombre, "Cliente de prueba");
});

test("rechaza campos no permitidos", () => {
  for (const field of ["empresa_id", "usuario_id", "id"]) {
    assert.equal(
      createCustomerSchema.safeParse({
        ...customer,
        [field]: "1",
      }).success,
      false,
    );
  }
});

test("normalización y validación de RFC", () => {
  const result = createCustomerSchema.parse({
    ...customer,
    rfc: " abc0102031a2 ",
  });

  assert.equal(result.rfc, "ABC0102031A2");

  for (const rfc of ["ABC", "123456789012", "ABC010203"]) {
    assert.equal(
      createCustomerSchema.safeParse({
        ...customer,
        rfc,
      }).success,
      false,
    );
  }
});

test("normalización y validación de correo", () => {
  const result = createCustomerSchema.parse({
    ...customer,
    email: "CLIENTE@EJEMPLO.COM",
  });

  assert.equal(result.email, "cliente@ejemplo.com");

  assert.equal(
    createCustomerSchema.safeParse({
      ...customer,
      email: "correo-invalido",
    }).success,
    false,
  );
});

test("límites y precisión de crédito", () => {
  for (const amount of ["0", "100.50", "999999999999.99"]) {
    assert.equal(
      createCustomerSchema.safeParse({
        ...customer,
        limite_credito: amount,
      }).success,
      true,
    );
  }

  for (const amount of ["-1", "1.001", "1e3", "1000000000000"]) {
    assert.equal(
      createCustomerSchema.safeParse({
        ...customer,
        limite_credito: amount,
      }).success,
      false,
    );
  }
});

test("días de crédito dentro del rango", () => {
  for (const days of [0, 30, 3650]) {
    assert.equal(
      createCustomerSchema.safeParse({
        ...customer,
        dias_credito: days,
      }).success,
      true,
    );
  }

  for (const days of [-1, 3651, 1.5]) {
    assert.equal(
      createCustomerSchema.safeParse({
        ...customer,
        dias_credito: days,
      }).success,
      false,
    );
  }
});

test("actualización de cliente", () => {
  assert.equal(updateCustomerSchema.safeParse({}).success, false);
  assert.equal(updateCustomerSchema.safeParse({
    nombre: "Cliente actualizado",
  }).success, true);
  assert.equal(updateCustomerSchema.safeParse({
    activo: false,
  }).success, true);
  assert.equal(updateCustomerSchema.safeParse({
    rfc: null,
    email: null,
  }).success, true);
});

test("registro de direcciones", () => {
  const result = createCustomerAddressSchema.parse({
    tipo: "FISCAL",
    calle: "Av. Principal",
    codigo_postal: "01234",
    es_principal: true,
  });

  assert.equal(result.codigo_postal, "01234");
  assert.equal(result.es_principal, true);
});

test("validación de actualización de dirección", () => {
  assert.equal(
    updateCustomerAddressSchema.safeParse({}).success,
    false,
  );

  assert.equal(
    updateCustomerAddressSchema.safeParse({
      colonia: "Centro",
    }).success,
    true,
  );

  assert.equal(
    createCustomerAddressSchema.safeParse({
      codigo_postal: "1234567890123456",
    }).success,
    false,
  );
});

test("paginación y filtros de clientes", () => {
  assert.deepEqual(customerListSchema.parse({}), {
    page: 1,
    pageSize: 25,
  });

  assert.equal(customerListSchema.safeParse({
    page: "0",
  }).success, false);

  assert.equal(customerListSchema.safeParse({
    pageSize: "101",
  }).success, false);

  assert.equal(customerListSchema.safeParse({
    activo: "false",
  }).success, true);
});

test("identificadores BIGINT", () => {
  assert.equal(idFromRoute("1"), 1n);
  assert.equal(
    idFromRoute("9223372036854775807"),
    9223372036854775807n,
  );

  for (const id of [
    "0",
    "-1",
    "abc",
    "9223372036854775808",
  ]) {
    assert.throws(() => idFromRoute(id));
  }
});

test("serialización de BigInt y Decimal", () => {
  const result = jsonSafe({
    id: 10n,
    limite_credito: new Prisma.Decimal("100.50"),
  });

  assert.deepEqual(result, {
    id: "10",
    limite_credito: "100.5",
  });
});

test("identificación de violaciones únicas", () => {
  assert.equal(isUniqueViolation({ code: "P2002" }), true);
  assert.equal(isUniqueViolation({ code: "P2003" }), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation(new Error("Otro")), false);
});

test("errores del módulo Clientes", () => {
  const notFound = customerError.notFound();
  const conflict = customerError.conflict("Duplicado");

  assert.ok(notFound instanceof CustomerError);
  assert.equal(notFound.status, 404);
  assert.equal(notFound.code, "CUSTOMER_NOT_FOUND");

  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, "CUSTOMER_CONFLICT");
});
