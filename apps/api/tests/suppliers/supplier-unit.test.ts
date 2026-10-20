import test from "node:test";
import assert from "node:assert/strict";

import { Prisma } from "../../src/generated/prisma/client.js";

import {
  createSupplierSchema,
  updateSupplierSchema,
  supplierListSchema,
  createSupplierAddressSchema,
  updateSupplierAddressSchema,
} from "../../src/modules/suppliers/supplier.schema.ts";

import {
  jsonSafe,
  idFromRoute,
  isPrismaErrorCode,
} from "../../src/modules/suppliers/supplier.utils.ts";

import {
  SupplierError,
  supplierError,
} from "../../src/modules/suppliers/supplier.errors.ts";

const supplier = {
  codigo: "PROV-001",
  razon_social: "Proveedor de prueba",
};

test("creación válida de proveedor", () => {
  const result = createSupplierSchema.parse(supplier);

  assert.equal(result.codigo, "PROV-001");
  assert.equal(result.razon_social, "Proveedor de prueba");
});

test("normalización de campos obligatorios", () => {
  const result = createSupplierSchema.parse({
    codigo: "  PROV-002  ",
    razon_social: "  Empresa Ejemplo  ",
  });

  assert.equal(result.codigo, "PROV-002");
  assert.equal(result.razon_social, "Empresa Ejemplo");
});

test("rechaza campos no permitidos", () => {
  for (const field of ["empresa_id", "usuario_id", "id"]) {
    assert.equal(
      createSupplierSchema.safeParse({
        ...supplier,
        [field]: "1",
      }).success,
      false,
    );
  }
});

test("campos obligatorios y límites de longitud", () => {
  assert.equal(
    createSupplierSchema.safeParse({
      razon_social: "Proveedor",
    }).success,
    false,
  );

  assert.equal(
    createSupplierSchema.safeParse({
      codigo: "A".repeat(41),
      razon_social: "Proveedor",
    }).success,
    false,
  );

  assert.equal(
    createSupplierSchema.safeParse({
      codigo: "PROV-001",
      razon_social: "A".repeat(181),
    }).success,
    false,
  );
});

test("normalización y validación de RFC", () => {
  const result = createSupplierSchema.parse({
    ...supplier,
    rfc: " abc0102031a2 ",
  });

  assert.equal(result.rfc, "ABC0102031A2");

  for (const rfc of [
    "ABC",
    "123456789012",
    "ABC010203",
  ]) {
    assert.equal(
      createSupplierSchema.safeParse({
        ...supplier,
        rfc,
      }).success,
      false,
    );
  }
});

test("normalización y validación de correo", () => {
  const result = createSupplierSchema.parse({
    ...supplier,
    email: "PROVEEDOR@EJEMPLO.COM",
  });

  assert.equal(result.email, "proveedor@ejemplo.com");

  assert.equal(
    createSupplierSchema.safeParse({
      ...supplier,
      email: "correo-invalido",
    }).success,
    false,
  );
});

test("campos opcionales y valores nulos", () => {
  const result = createSupplierSchema.safeParse({
    ...supplier,
    nombre_comercial: null,
    rfc: null,
    email: null,
    telefono: null,
    contacto: null,
  });

  assert.equal(result.success, true);
});

test("validación de días de crédito", () => {
  for (const days of [0, 30, 3650]) {
    assert.equal(
      createSupplierSchema.safeParse({
        ...supplier,
        dias_credito: days,
      }).success,
      true,
    );
  }

  for (const days of [-1, 3651, 1.5]) {
    assert.equal(
      createSupplierSchema.safeParse({
        ...supplier,
        dias_credito: days,
      }).success,
      false,
    );
  }
});

test("actualización de proveedor", () => {
  assert.equal(
    updateSupplierSchema.safeParse({}).success,
    false,
  );

  assert.equal(
    updateSupplierSchema.safeParse({
      razon_social: "Empresa actualizada",
    }).success,
    true,
  );

  assert.equal(
    updateSupplierSchema.safeParse({
      activo: false,
    }).success,
    true,
  );

  assert.equal(
    updateSupplierSchema.safeParse({
      rfc: null,
      email: null,
    }).success,
    true,
  );
});

test("registro de direcciones", () => {
  const result = createSupplierAddressSchema.parse({
    tipo: "FISCAL",
    calle: "Av. Principal",
    numero_exterior: "100",
    codigo_postal: "01234",
    pais: "México",
    es_principal: true,
  });

  assert.equal(result.codigo_postal, "01234");
  assert.equal(result.es_principal, true);

  assert.equal(
    createSupplierAddressSchema.safeParse({
      calle: "Av. Principal",
      empresa_id: "1",
    }).success,
    false,
  );
});

test("actualización de direcciones", () => {
  assert.equal(
    updateSupplierAddressSchema.safeParse({}).success,
    false,
  );

  assert.equal(
    updateSupplierAddressSchema.safeParse({
      colonia: "Centro",
    }).success,
    true,
  );

  assert.equal(
    createSupplierAddressSchema.safeParse({
      codigo_postal: "1234567890123456",
    }).success,
    false,
  );
});

test("paginación y filtros de proveedores", () => {
  assert.deepEqual(supplierListSchema.parse({}), {
    page: 1,
    pageSize: 25,
  });

  assert.equal(
    supplierListSchema.safeParse({
      page: "0",
    }).success,
    false,
  );

  assert.equal(
    supplierListSchema.safeParse({
      pageSize: "101",
    }).success,
    false,
  );

  assert.equal(
    supplierListSchema.safeParse({
      activo: "false",
      q: "Proveedor",
    }).success,
    true,
  );

  assert.equal(
    supplierListSchema.safeParse({
      campo_desconocido: "valor",
    }).success,
    false,
  );
});

test("validación de identificadores BIGINT", () => {
  assert.equal(idFromRoute("1"), 1n);

  assert.equal(
    idFromRoute("9223372036854775807"),
    9223372036854775807n,
  );

  for (const id of [
    "0",
    "-1",
    "abc",
    "01",
    "9223372036854775808",
  ]) {
    assert.throws(
      () => idFromRoute(id),
      /INVALID_ID/,
    );
  }
});

test("serialización de BigInt y Decimal", () => {
  const result = jsonSafe({
    id: 10n,
    importe: new Prisma.Decimal("100.50"),
  });

  assert.deepEqual(result, {
    id: "10",
    importe: "100.5",
  });
});

test("errores de Prisma y del módulo", () => {
  assert.equal(
    isPrismaErrorCode({ code: "P2002" }, "P2002"),
    true,
  );

  assert.equal(
    isPrismaErrorCode({ code: "P2003" }, "P2002"),
    false,
  );

  assert.equal(
    isPrismaErrorCode(null, "P2002"),
    false,
  );

  const notFound = supplierError.notFound();
  const conflict = supplierError.conflict("Duplicado");

  assert.ok(notFound instanceof SupplierError);
  assert.equal(notFound.status, 404);
  assert.equal(notFound.code, "SUPPLIER_NOT_FOUND");

  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, "SUPPLIER_CONFLICT");
});
