import {
  SaleQueryAccessError,
  SaleQueryNotFoundError,
} from "../sale.query.service.js";

import {
  saleQueryRepository,
} from "../sale.query.repository.js";

import {
  decimalToNumber,
  moneyToCents,
} from "../utils/sale-money.js";

import {
  saleFinancialRepository,
} from "./sale-financial.repository.js";

type FinancialSale =
  NonNullable<
    Awaited<
      ReturnType<
        typeof saleFinancialRepository.findById
      >
    >
  >;

interface PaymentMethodSummary {
  metodo_pago: {
    id: string;
    codigo: string;
    nombre: string;
    es_efectivo: boolean;
  };
  monto_original_centavos: number;
  monto_devuelto_centavos: number;
  monto_revertido_cancelacion_centavos: number;
  monto_neto_centavos: number;
}

function centsToMoney(
  cents: number,
): number {
  return cents / 100;
}

function getFinancialStatus(
  sale: FinancialSale,
  returnedCents: number,
): string {
  if (
    sale.estado ===
    "CANCELADA"
  ) {
    return "CANCELADA";
  }

  const saleTotalCents =
    moneyToCents(
      decimalToNumber(
        sale.total,
      ),
    );

  if (
    returnedCents <= 0
  ) {
    return "VIGENTE";
  }

  if (
    returnedCents >=
    saleTotalCents
  ) {
    return "DEVUELTA_TOTAL";
  }

  return "DEVUELTA_PARCIAL";
}

function buildMethodSummaries(
  sale: FinancialSale,
) {
  const methods =
    new Map<
      string,
      PaymentMethodSummary
    >();

  for (
    const payment of
    sale.venta_pago
  ) {
    const key =
      payment.metodo_pago.id
        .toString();

    const originalCents =
      moneyToCents(
        decimalToNumber(
          payment.monto,
        ),
      );

    const refundedCents =
      payment.devolucion_pago.reduce(
        (
          total,
          refund,
        ) =>
          total +
          moneyToCents(
            decimalToNumber(
              refund.monto,
            ),
          ),
        0,
      );

    const cancellationCents =
      sale.estado ===
      "CANCELADA"
        ? Math.max(
            0,
            originalCents -
              refundedCents,
          )
        : 0;

    const netCents =
      Math.max(
        0,
        originalCents -
          refundedCents -
          cancellationCents,
      );

    const current =
      methods.get(key);

    if (current) {
      current.monto_original_centavos +=
        originalCents;

      current.monto_devuelto_centavos +=
        refundedCents;

      current.monto_revertido_cancelacion_centavos +=
        cancellationCents;

      current.monto_neto_centavos +=
        netCents;

      continue;
    }

    methods.set(
      key,
      {
        metodo_pago: {
          id: key,
          codigo:
            payment.metodo_pago
              .codigo,
          nombre:
            payment.metodo_pago
              .nombre,
          es_efectivo:
            payment.metodo_pago
              .es_efectivo,
        },
        monto_original_centavos:
          originalCents,
        monto_devuelto_centavos:
          refundedCents,
        monto_revertido_cancelacion_centavos:
          cancellationCents,
        monto_neto_centavos:
          netCents,
      },
    );
  }

  return Array.from(
    methods.values(),
  ).map(
    (method) => ({
      metodo_pago:
        method.metodo_pago,

      monto_original:
        centsToMoney(
          method.monto_original_centavos,
        ),

      monto_devuelto:
        centsToMoney(
          method.monto_devuelto_centavos,
        ),

      monto_revertido_cancelacion:
        centsToMoney(
          method.monto_revertido_cancelacion_centavos,
        ),

      monto_neto:
        centsToMoney(
          method.monto_neto_centavos,
        ),
    }),
  );
}

export const saleFinancialService = {
  async getSummary(
    userId: bigint,
    saleId: bigint,
  ) {
    const user =
      await saleQueryRepository
        .findUserCompany(
          userId,
        );

    if (
      !user ||
      !user.activo ||
      user.bloqueado
    ) {
      throw new SaleQueryAccessError();
    }

    const sale =
      await saleFinancialRepository
        .findById(
          user.empresa_id,
          saleId,
        );

    if (!sale) {
      throw new SaleQueryNotFoundError();
    }

    const methods =
      buildMethodSummaries(
        sale,
      );

    const paidCents =
      methods.reduce(
        (
          total,
          method,
        ) =>
          total +
          moneyToCents(
            method.monto_original,
          ),
        0,
      );

    const returnedCents =
      methods.reduce(
        (
          total,
          method,
        ) =>
          total +
          moneyToCents(
            method.monto_devuelto,
          ),
        0,
      );

    const cancellationCents =
      methods.reduce(
        (
          total,
          method,
        ) =>
          total +
          moneyToCents(
            method.monto_revertido_cancelacion,
          ),
        0,
      );

    const netPaymentCents =
      methods.reduce(
        (
          total,
          method,
        ) =>
          total +
          moneyToCents(
            method.monto_neto,
          ),
        0,
      );

    const saleTotalCents =
      moneyToCents(
        decimalToNumber(
          sale.total,
        ),
      );

    const netSaleCents =
      sale.estado ===
      "CANCELADA"
        ? 0
        : Math.max(
            0,
            saleTotalCents -
              returnedCents,
          );

    const cash =
      methods.filter(
        (method) =>
          method.metodo_pago
            .es_efectivo,
      );

    const cashOriginalCents =
      cash.reduce(
        (total, method) =>
          total +
          moneyToCents(
            method.monto_original,
          ),
        0,
      );

    const cashReturnedCents =
      cash.reduce(
        (total, method) =>
          total +
          moneyToCents(
            method.monto_devuelto,
          ),
        0,
      );

    const cashCancelledCents =
      cash.reduce(
        (total, method) =>
          total +
          moneyToCents(
            method.monto_revertido_cancelacion,
          ),
        0,
      );

    const cashNetCents =
      cash.reduce(
        (total, method) =>
          total +
          moneyToCents(
            method.monto_neto,
          ),
        0,
      );

    const credit =
      methods.filter(
        (method) =>
          method.metodo_pago
            .codigo ===
          "CREDITO",
      );

    const creditOriginalCents =
      credit.reduce(
        (total, method) =>
          total +
          moneyToCents(
            method.monto_original,
          ),
        0,
      );

    const creditReturnedCents =
      credit.reduce(
        (total, method) =>
          total +
          moneyToCents(
            method.monto_devuelto,
          ),
        0,
      );

    const creditNetCents =
      credit.reduce(
        (total, method) =>
          total +
          moneyToCents(
            method.monto_neto,
          ),
        0,
      );

    return {
      venta: {
        id:
          sale.id.toString(),
        folio:
          sale.folio,
        fecha:
          sale.fecha,
        estado:
          sale.estado,
        condicion_pago:
          sale.condicion_pago,
      },

      resumen: {
        total_venta:
          centsToMoney(
            saleTotalCents,
          ),

        total_pagos_registrados:
          centsToMoney(
            paidCents,
          ),

        total_devuelto:
          centsToMoney(
            returnedCents,
          ),

        total_revertido_cancelacion:
          centsToMoney(
            cancellationCents,
          ),

        total_neto_venta:
          centsToMoney(
            netSaleCents,
          ),

        total_neto_pagos:
          centsToMoney(
            netPaymentCents,
          ),

        estado_financiero:
          getFinancialStatus(
            sale,
            returnedCents,
          ),
      },

      metodos_pago:
        methods,

      efectivo: {
        ingresado:
          centsToMoney(
            cashOriginalCents,
          ),

        devuelto:
          centsToMoney(
            cashReturnedCents,
          ),

        revertido_cancelacion:
          centsToMoney(
            cashCancelledCents,
          ),

        neto:
          centsToMoney(
            cashNetCents,
          ),
      },

      credito:
        creditOriginalCents > 0
          ? {
              monto_original:
                centsToMoney(
                  creditOriginalCents,
                ),

              monto_devuelto:
                centsToMoney(
                  creditReturnedCents,
                ),

              monto_neto_post_devoluciones:
                centsToMoney(
                  creditNetCents,
                ),

              cliente:
                sale.cliente
                  ? {
                      id:
                        sale.cliente.id
                          .toString(),

                      codigo:
                        sale.cliente
                          .codigo,

                      nombre:
                        sale.cliente
                          .nombre,

                      limite_credito:
                        decimalToNumber(
                          sale.cliente
                            .limite_credito,
                        ),

                      dias_credito:
                        sale.cliente
                          .dias_credito,
                    }
                  : null,

              cuentas_por_cobrar_integrado:
                false,
            }
          : null,
    };
  },
};
