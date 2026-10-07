import assert from "node:assert/strict";
import test from "node:test";

import {
  createSaleReturnSchema,
} from "../returns/sale-return.schema.js";

import {
  SaleCreditRequiresClientError,
} from "../errors/sale.errors.js";

import {
  salePaymentRepository,
} from "../repositories/sale-payment.repository.js";

import {
  prepareSalePayments,
} from "../services/create/sale-payment.preparer.js";

import {
  listSalesQuerySchema,
} from "../sale.query.schema.js";

import {
  createSaleSchema,
} from "../sale.schema.js";

import {
  calculateSaleTotals,
  validateSalePaymentTotal,
} from "../services/create/sale-totals.js";

import {
  moneyToCents,
  roundMoney,
} from "../utils/sale-money.js";

test(
  "roundMoney redondea a dos decimales",
  () => {
    assert.equal(
      roundMoney(10.125),
      10.13,
    );
  },
);

test(
  "moneyToCents evita comparar montos con flotantes",
  () => {
    assert.equal(
      moneyToCents(1135.94),
      113594,
    );
  },
);

test(
  "calculateSaleTotals suma los importes preparados",
  () => {
    const totals =
      calculateSaleTotals(
        [
          {
            subtotalLinea: 100,
            descuentoImporte: 10,
            impuestoImporte: 14.4,
            totalLinea: 104.4,
          },
          {
            subtotalLinea: 50,
            descuentoImporte: 0,
            impuestoImporte: 8,
            totalLinea: 58,
          },
        ] as never,
      );

    assert.deepEqual(
      totals,
      {
        subtotal: 150,
        descuento: 10,
        impuesto: 22.4,
        total: 162.4,
      },
    );
  },
);

test(
  "validateSalePaymentTotal acepta pagos exactamente iguales al total",
  () => {
    assert.doesNotThrow(
      () =>
        validateSalePaymentTotal(
          [
            {
              monto: 100,
            },
            {
              monto: 62.4,
            },
          ] as never,
          162.4,
        ),
    );
  },
);

test(
  "validateSalePaymentTotal rechaza una suma diferente",
  () => {
    assert.throws(
      () =>
        validateSalePaymentTotal(
          [
            {
              monto: 100,
            },
          ] as never,
          162.4,
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.name ===
          "SalePaymentTotalMismatchError",
    );
  },
);

test(
  "createSaleSchema rechaza pagos con más de dos decimales",
  () => {
    const result =
      createSaleSchema.safeParse({
        empresa_id: "1",
        sucursal_id: "1",
        almacen_id: "1",
        cliente_id: "1",
        folio: "TEST-SCHEMA-001",
        detalles: [
          {
            producto_id: "1",
            cantidad: 1,
            descuento_porcentaje: 0,
          },
        ],
        pagos: [
          {
            metodo_pago_id: "1",
            monto: 10.001,
          },
        ],
      });

    assert.equal(
      result.success,
      false,
    );
  },
);

test(
  "createSaleReturnSchema rechaza reembolsos con más de dos decimales",
  () => {
    const result =
      createSaleReturnSchema.safeParse({
        folio:
          "TEST-RETURN-SCHEMA-001",
        motivo:
          "Prueba automatizada",
        detalles: [
          {
            venta_detalle_id:
              "1",
            cantidad:
              1,
          },
        ],
        reembolsos: [
          {
            venta_pago_id:
              "1",
            monto:
              10.001,
          },
        ],
      });

    assert.equal(
      result.success,
      false,
    );
  },
);

test(
  "listSalesQuerySchema rechaza IDs fuera de PostgreSQL BIGINT",
  () => {
    const result =
      listSalesQuerySchema.safeParse({
        sucursal_id:
          "9223372036854775808",
      });

    assert.equal(
      result.success,
      false,
    );
  },
);

test(
  "listSalesQuerySchema acepta y normaliza estado",
  () => {
    const result =
      listSalesQuerySchema.safeParse({
        estado:
          "completada",
      });

    assert.equal(
      result.success,
      true,
    );

    if (result.success) {
      assert.equal(
        result.data.estado,
        "COMPLETADA",
      );
    }
  },
);

test(
  "prepareSalePayments exige cliente cuando existe un pago CREDITO",
  async () => {
    const originalFindPaymentMethod =
      salePaymentRepository.findPaymentMethod;

    salePaymentRepository.findPaymentMethod =
      (async () => ({
        id: 4n,
        codigo: "CREDITO",
        nombre: "Crédito",
        es_efectivo: false,
        activo: true,
      })) as typeof salePaymentRepository.findPaymentMethod;

    try {
      await assert.rejects(
        () =>
          prepareSalePayments(
            {} as never,
            {
              empresaId: 1n,
              sucursalId: 1n,
              almacenId: 1n,
              clienteId: null,
              usuarioId: 1n,
              folio: "TEST-CREDITO-SIN-CLIENTE",
              detalles: [],
              pagos: [
                {
                  metodoPagoId: 4n,
                  monto: 100,
                },
              ],
            },
          ),
        (error: unknown) =>
          error instanceof
          SaleCreditRequiresClientError,
      );
    } finally {
      salePaymentRepository.findPaymentMethod =
        originalFindPaymentMethod;
    }
  },
);
