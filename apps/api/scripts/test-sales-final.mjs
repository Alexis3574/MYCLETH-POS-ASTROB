import "dotenv/config";

import assert from "node:assert/strict";

import {
  prisma,
} from "../src/lib/prisma.js";

import {
  roundMoney,
} from "../src/modules/sales/utils/sale-money.js";

const API_URL =
  process.env.SALES_TEST_API_URL ??
  "http://localhost:3000/api/v1";

const TOKEN =
  process.env.SALES_TEST_TOKEN ??
  "";

function uniqueFolio(
  prefix,
) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function request(
  path,
  options = {},
) {
  const response =
    await fetch(
      `${API_URL}${path}`,
      {
        ...options,
        headers: {
          Authorization:
            `Bearer ${TOKEN}`,
          Accept:
            "application/json",
          ...(options.body
            ? {
                "Content-Type":
                  "application/json",
              }
            : {}),
          ...(options.headers ?? {}),
        },
      },
    );

  const text =
    await response.text();

  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {
    status:
      response.status,
    body,
  };
}

function assertStatus(
  result,
  expected,
  label,
) {
  assert.equal(
    result.status,
    expected,
    `${label}: HTTP ${result.status} - ${JSON.stringify(result.body)}`,
  );
}


async function cleanupAbandonedTestSales() {
  const me =
    await request(
      "/auth/me",
    );

  assertStatus(
    me,
    200,
    "Autenticación para limpieza previa",
  );

  const empresaId =
    BigInt(
      me.body.data.empresa.id,
    );

  const abandoned =
    await prisma.venta.findMany({
      where: {
        empresa_id:
          empresaId,
        estado:
          "COMPLETADA",
        folio: {
          startsWith:
            "AUTO-",
        },
        devolucion_venta: {
          none: {},
        },
      },
      select: {
        id: true,
        folio: true,
      },
      orderBy: {
        id: "asc",
      },
    });

  if (
    abandoned.length ===
    0
  ) {
    return;
  }

  console.log(
    `Limpieza previa: ${abandoned.length} venta(s) automática(s) COMPLETADA(S) sin devolución.`,
  );

  for (
    const sale of
    abandoned
  ) {
    const result =
      await request(
        `/sales/${sale.id.toString()}/cancel`,
        {
          method:
            "PATCH",
        },
      );

    if (
      result.status ===
      200
    ) {
      console.log(
        `  ✓ cancelada ${sale.folio} (venta ${sale.id.toString()})`,
      );

      continue;
    }

    if (
      result.status ===
        409 &&
      result.body?.code ===
        "SALE_CANNOT_BE_CANCELLED"
    ) {
      continue;
    }

    throw new Error(
      `No se pudo limpiar la venta automática ${sale.folio}: HTTP ${result.status} - ${JSON.stringify(result.body)}`,
    );
  }
}

async function getContext() {
  const me =
    await request(
      "/auth/me",
    );

  assertStatus(
    me,
    200,
    "Autenticación",
  );

  const empresaId =
    BigInt(
      me.body.data.empresa.id,
    );

  const client =
    await prisma.cliente.findFirst({
      where: {
        empresa_id:
          empresaId,
        activo:
          true,
      },
      orderBy: {
        id: "asc",
      },
    });

  assert.ok(
    client,
    "Se requiere al menos un cliente activo para las pruebas de sales.",
  );

  const methods =
    await prisma.metodo_pago.findMany({
      where: {
        codigo: {
          in: [
            "TRANSFERENCIA",
            "CREDITO",
          ],
        },
        activo:
          true,
      },
    });

  const transfer =
    methods.find(
      (method) =>
        method.codigo ===
        "TRANSFERENCIA",
    );

  const credit =
    methods.find(
      (method) =>
        method.codigo ===
        "CREDITO",
    );

  assert.ok(
    transfer,
    "No existe un método de pago TRANSFERENCIA activo.",
  );

  assert.ok(
    credit,
    "No existe un método de pago CREDITO activo.",
  );

  const stocks =
    await prisma.existencia.findMany({
      where: {
        producto: {
          empresa_id:
            empresaId,
          activo:
            true,
          controla_inventario:
            true,
          precio_venta: {
            gt: 0,
          },
          codigo_barras: {
            not: null,
          },
        },
        almacen: {
          activo:
            true,
          sucursal: {
            empresa_id:
              empresaId,
            activo:
              true,
          },
        },
      },
      include: {
        producto: {
          include: {
            producto_impuesto: {
              include: {
                impuesto: true,
              },
            },
          },
        },
        almacen: {
          include: {
            sucursal: true,
          },
        },
      },
      orderBy: [
        {
          producto_id:
            "asc",
        },
        {
          almacen_id:
            "asc",
        },
      ],
      take: 50,
    });

  const stock =
    stocks.find(
      (row) => {
        const available =
          row.disponible === null
            ? Number(row.cantidad) -
              Number(row.reservado)
            : Number(
                row.disponible,
              );

        return (
          Number.isFinite(
            available,
          ) &&
          available >= 1
        );
      },
    );

  assert.ok(
    stock,
    "No se encontró un producto con inventario disponible para ejecutar las pruebas.",
  );

  const price =
    Number(
      stock.producto
        .precio_venta,
    );

  let taxRate = 0;

  for (
    const relation of
    stock.producto
      .producto_impuesto
  ) {
    if (
      relation.impuesto.activo &&
      relation.impuesto.empresa_id ===
        empresaId
    ) {
      taxRate +=
        Number(
          relation.impuesto.tasa,
        );
    }
  }

  const subtotal =
    roundMoney(price);

  const tax =
    roundMoney(
      subtotal *
        (taxRate / 100),
    );

  const total =
    roundMoney(
      subtotal + tax,
    );

  assert.ok(
    total > 0,
    "El producto de prueba debe tener un total mayor a cero.",
  );

  return {
    empresaId,
    client,
    transfer,
    credit,
    stock,
    total,
  };
}

function createSaleBody(
  context,
  method,
  folio,
) {
  return {
    empresa_id:
      context.empresaId
        .toString(),

    sucursal_id:
      context.stock
        .almacen
        .sucursal_id
        .toString(),

    almacen_id:
      context.stock
        .almacen_id
        .toString(),

    cliente_id:
      context.client.id
        .toString(),

    folio,

    observaciones:
      "Prueba automatizada final del módulo sales",

    detalles: [
      {
        producto_id:
          context.stock
            .producto_id
            .toString(),
        cantidad:
          1,
        descuento_porcentaje:
          0,
      },
    ],

    pagos: [
      {
        metodo_pago_id:
          method.id
            .toString(),
        monto:
          context.total,
        referencia:
          folio,
      },
    ],
  };
}

async function createSale(
  body,
) {
  return request(
    "/sales",
    {
      method: "POST",
      body:
        JSON.stringify(body),
    },
  );
}

async function getSale(
  saleId,
) {
  return request(
    `/sales/${saleId}`,
  );
}

async function runCreateAndCancelConcurrency(
  context,
) {
  const folio =
    uniqueFolio(
      "AUTO-CONC",
    );

  const body =
    createSaleBody(
      context,
      context.transfer,
      folio,
    );

  const results =
    await Promise.all([
      createSale(body),
      createSale(body),
    ]);

  const statuses =
    results
      .map(
        (result) =>
          result.status,
      )
      .sort(
        (a, b) =>
          a - b,
      );

  assert.deepEqual(
    statuses,
    [201, 409],
    `Creación concurrente inesperada: ${JSON.stringify(results)}`,
  );

  const conflict =
    results.find(
      (result) =>
        result.status ===
        409,
    );

  assert.ok(
    conflict,
    `Debe existir un conflicto en la creación concurrente: ${JSON.stringify(results)}`,
  );

  assert.ok(
    [
      "SALE_FOLIO_ALREADY_EXISTS",
      "INSUFFICIENT_STOCK",
    ].includes(
      conflict.body?.code,
    ),
    `Código de conflicto concurrente inesperado: ${JSON.stringify(conflict.body)}`,
  );

  const created =
    results.find(
      (result) =>
        result.status ===
        201,
    );

  const saleId =
    created.body.data.id;

  const cancelResults =
    await Promise.all([
      request(
        `/sales/${saleId}/cancel`,
        {
          method:
            "PATCH",
        },
      ),
      request(
        `/sales/${saleId}/cancel`,
        {
          method:
            "PATCH",
        },
      ),
    ]);

  const cancelStatuses =
    cancelResults
      .map(
        (result) =>
          result.status,
      )
      .sort(
        (a, b) =>
          a - b,
      );

  assert.deepEqual(
    cancelStatuses,
    [200, 409],
    `Cancelación concurrente inesperada: ${JSON.stringify(cancelResults)}`,
  );

  const sale =
    await getSale(
      saleId,
    );

  assertStatus(
    sale,
    200,
    "Consulta posterior a cancelación",
  );

  assert.equal(
    sale.body.data.estado,
    "CANCELADA",
  );

  /*
   * Con una sola unidad disponible, la segunda petición
   * concurrente puede fallar por INSUFFICIENT_STOCK antes
   * de intentar insertar la venta y alcanzar el índice único
   * del folio. La cancelación anterior restaura esa unidad.
   *
   * Reintentamos ahora el mismo folio para comprobar de forma
   * determinista la protección uq_venta_sucursal_folio.
   */
  const duplicateFolioRetry =
    await createSale(body);

  assertStatus(
    duplicateFolioRetry,
    409,
    "Reintento con folio ya existente",
  );

  assert.equal(
    duplicateFolioRetry.body?.code,
    "SALE_FOLIO_ALREADY_EXISTS",
    `El reintento del folio debe ser bloqueado por idempotencia: ${JSON.stringify(duplicateFolioRetry.body)}`,
  );

  const audits =
    await prisma.auditoria.findMany({
      where: {
        tabla:
          "venta",
        registro_id:
          BigInt(saleId),
        accion: {
          in: [
            "INSERT",
            "UPDATE",
          ],
        },
      },
      select: {
        accion: true,
      },
    });

  const auditActions =
    new Set(
      audits.map(
        (audit) =>
          audit.accion,
      ),
    );

  assert.ok(
    auditActions.has("INSERT") &&
      auditActions.has("UPDATE"),
    "La venta de concurrencia debe tener auditoría INSERT y UPDATE.",
  );

  console.log(
    `✓ creación concurrente: 201 + 409 (${conflict.body?.code}) sin duplicar venta`,
  );
  console.log(
    "✓ idempotencia por folio: reintento bloqueado con SALE_FOLIO_ALREADY_EXISTS",
  );
  console.log(
    "✓ cancelación concurrente: 200 + 409 sin doble reversión",
  );
}

async function createAndReturn(
  context,
  method,
  prefix,
) {
  const saleFolio =
    uniqueFolio(
      `${prefix}-SALE`,
    );

  const create =
    await createSale(
      createSaleBody(
        context,
        method,
        saleFolio,
      ),
    );

  assertStatus(
    create,
    201,
    `Creación ${method.codigo}`,
  );

  const saleId =
    create.body.data.id;

  const sale =
    await getSale(
      saleId,
    );

  assertStatus(
    sale,
    200,
    `Consulta ${method.codigo}`,
  );

  const detail =
    sale.body.data.detalles[0];

  const payment =
    sale.body.data.pagos[0];

  const returnFolio =
    uniqueFolio(
      `${prefix}-RETURN`,
    );

  const returnBody = {
    folio:
      returnFolio,
    motivo:
      `Prueba devolución ${method.codigo}`,
    detalles: [
      {
        venta_detalle_id:
          detail.id,
        cantidad:
          1,
      },
    ],
    reembolsos: [
      {
        venta_pago_id:
          payment.id,
        monto:
          context.total,
        referencia:
          returnFolio,
      },
    ],
  };

  const returned =
    await request(
      `/sales/${saleId}/returns`,
      {
        method: "POST",
        body:
          JSON.stringify(
            returnBody,
          ),
      },
    );

  assertStatus(
    returned,
    201,
    `Devolución ${method.codigo}`,
  );

  const returnId =
    returned.body.data.id;

  const cashMovements =
    await prisma.movimiento_caja.count({
      where: {
        referencia: {
          startsWith:
            `DEVOLUCION:${returnId}:`,
        },
      },
    });

  assert.equal(
    cashMovements,
    0,
    `${method.codigo} no debe generar movimiento_caja en una devolución.`,
  );

  const financial =
    await request(
      `/sales/${saleId}/financial-summary`,
    );

  assertStatus(
    financial,
    200,
    `Resumen financiero ${method.codigo}`,
  );

  assert.equal(
    financial.body.data.resumen
      .estado_financiero,
    "DEVUELTA_TOTAL",
  );

  assert.equal(
    financial.body.data.resumen
      .total_neto_venta,
    0,
  );

  const returnAudit =
    await prisma.auditoria.findFirst({
      where: {
        tabla:
          "devolucion_venta",
        registro_id:
          BigInt(returnId),
        accion:
          "INSERT",
      },
      select: {
        id: true,
      },
    });

  assert.ok(
    returnAudit,
    "La devolución debe generar auditoría INSERT.",
  );

  console.log(
    `✓ devolución ${method.codigo}: sin movimiento de caja y resumen financiero correcto`,
  );

  return {
    saleId,
    returnId,
  };
}

async function runReturnConcurrency(
  context,
) {
  const saleFolio =
    uniqueFolio(
      "AUTO-RET-CONC-SALE",
    );

  const create =
    await createSale(
      createSaleBody(
        context,
        context.transfer,
        saleFolio,
      ),
    );

  assertStatus(
    create,
    201,
    "Creación para devolución concurrente",
  );

  const saleId =
    create.body.data.id;

  const sale =
    await getSale(
      saleId,
    );

  assertStatus(
    sale,
    200,
    "Consulta para devolución concurrente",
  );

  const detailId =
    sale.body.data.detalles[0].id;

  const paymentId =
    sale.body.data.pagos[0].id;

  const buildReturn =
    (suffix) => ({
      folio:
        uniqueFolio(
          `AUTO-RET-CONC-${suffix}`,
        ),
      motivo:
        "Prueba de devolución concurrente",
      detalles: [
        {
          venta_detalle_id:
            detailId,
          cantidad:
            1,
        },
      ],
      reembolsos: [
        {
          venta_pago_id:
            paymentId,
          monto:
            context.total,
          referencia:
            `CONC-${suffix}`,
        },
      ],
    });

  const results =
    await Promise.all([
      request(
        `/sales/${saleId}/returns`,
        {
          method: "POST",
          body:
            JSON.stringify(
              buildReturn("A"),
            ),
        },
      ),
      request(
        `/sales/${saleId}/returns`,
        {
          method: "POST",
          body:
            JSON.stringify(
              buildReturn("B"),
            ),
        },
      ),
    ]);

  const successes =
    results.filter(
      (result) =>
        result.status ===
        201,
    );

  const conflicts =
    results.filter(
      (result) =>
        result.status ===
        409,
    );

  assert.equal(
    successes.length,
    1,
    `Debe existir una sola devolución exitosa: ${JSON.stringify(results)}`,
  );

  assert.equal(
    conflicts.length,
    1,
    `Debe existir un solo conflicto de devolución: ${JSON.stringify(results)}`,
  );

  assert.ok(
    [
      "RETURN_QUANTITY_EXCEEDED",
      "RETURN_PAYMENT_EXCEEDED",
    ].includes(
      conflicts[0].body.code,
    ),
    `Código de conflicto inesperado: ${JSON.stringify(conflicts[0].body)}`,
  );

  console.log(
    "✓ devolución concurrente: una sola devolución aplicada",
  );
}

async function main() {
  if (!TOKEN) {
    throw new Error(
      "Define SALES_TEST_TOKEN con un JWT válido antes de ejecutar esta prueba.",
    );
  }

  console.log(
    `API de pruebas: ${API_URL}`,
  );

  await cleanupAbandonedTestSales();

  const context =
    await getContext();

  console.log(
    `Producto: ${context.stock.producto.sku} | almacén: ${context.stock.almacen_id.toString()} | total unitario: ${context.total.toFixed(2)}`,
  );

  await runCreateAndCancelConcurrency(
    context,
  );

  await runReturnConcurrency(
    context,
  );

  await createAndReturn(
    context,
    context.transfer,
    "AUTO-TRANSFER",
  );

  const creditResult =
    await createAndReturn(
      context,
      context.credit,
      "AUTO-CREDIT",
    );

  const creditFinancial =
    await request(
      `/sales/${creditResult.saleId}/financial-summary`,
    );

  assert.ok(
    creditFinancial.body.data.credito,
    "El resumen financiero de una venta CREDITO debe incluir el bloque credito.",
  );

  assert.equal(
    creditFinancial.body.data.credito
      .cuentas_por_cobrar_integrado,
    false,
  );

  console.log(
    "✓ venta CREDITO preparada para futuro módulo de cuentas por cobrar",
  );
  console.log(
    "\nTODAS LAS PRUEBAS FINALES DE SALES PASARON.",
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
