import {
  SaleReturnDetailError,
  SaleReturnDuplicateDetailError,
  SaleReturnQuantityExceededError,
} from "../errors/sale-return.errors.js";

import {
  saleReturnRepository,
} from "../repositories/sale-return.repository.js";

import type {
  LockedReturnSale,
} from "../repositories/sale-return.repository.js";

import type {
  SaleReturnDetailInput,
} from "../types/sale-return.types.js";

import type {
  SaleTransaction,
} from "../../types/sales.types.js";

import {
  decimalToNumber,
  roundMoney,
} from "../../utils/sale-money.js";

type SaleDetail =
  LockedReturnSale["venta_detalle"][number];

export interface PreparedReturnItem {
  saleDetail:
    SaleDetail;

  cantidad:
    number;

  subtotalLinea:
    number;

  descuentoImporte:
    number;

  impuestoImporte:
    number;

  totalLinea:
    number;
}

export interface ReturnTotals {
  subtotal:
    number;

  descuento:
    number;

  impuesto:
    number;

  total:
    number;
}

function roundQuantity(
  value: number,
): number {
  return (
    Math.round(
      (
        value +
        Number.EPSILON
      ) *
        1000,
    ) / 1000
  );
}

function calculatePartialAmount(
  original:
    number,

  alreadyReturned:
    number,

  requestedQuantity:
    number,

  originalQuantity:
    number,

  isFinalReturn:
    boolean,
): number {
  if (isFinalReturn) {
    return roundMoney(
      Math.max(
        0,
        original -
          alreadyReturned,
      ),
    );
  }

  return roundMoney(
    original *
      (
        requestedQuantity /
        originalQuantity
      ),
  );
}

export async function prepareReturnItems(
  tx: SaleTransaction,
  sale: LockedReturnSale,
  details: SaleReturnDetailInput[],
) {
  const preparedItems:
    PreparedReturnItem[] = [];

  const usedIds =
    new Set<string>();

  for (
    const item of
    details
  ) {
    const key =
      item.saleDetailId.toString();

    if (
      usedIds.has(
        key,
      )
    ) {
      throw new SaleReturnDuplicateDetailError(
        item.saleDetailId,
      );
    }

    usedIds.add(
      key,
    );

    const saleDetail =
      sale.venta_detalle.find(
        (detail) =>
          detail.id ===
          item.saleDetailId,
      );

    if (!saleDetail) {
      throw new SaleReturnDetailError(
        item.saleDetailId,
      );
    }

    const originalQuantity =
      decimalToNumber(
        saleDetail.cantidad,
      );

    const requestedQuantity =
      roundQuantity(
        item.cantidad,
      );

    if (
      saleDetail.producto
        .controla_inventario &&
      !Number.isInteger(
        requestedQuantity,
      )
    ) {
      throw new Error(
        `El producto ${saleDetail.producto.sku} requiere una cantidad entera para sincronizar correctamente el inventario con el e-commerce.`,
      );
    }

    const returned =
      await saleReturnRepository
        .getReturnedDetailTotals(
          tx,
          saleDetail.id,
        );

    const alreadyReturnedQuantity =
      roundQuantity(
        decimalToNumber(
          returned._sum
            .cantidad ??
            0,
        ),
      );

    const availableQuantity =
      roundQuantity(
        Math.max(
          0,
          originalQuantity -
            alreadyReturnedQuantity,
        ),
      );

    if (
      requestedQuantity >
      availableQuantity
    ) {
      throw new SaleReturnQuantityExceededError(
        saleDetail.id,
        originalQuantity,
        alreadyReturnedQuantity,
        requestedQuantity,
        availableQuantity,
      );
    }

    const isFinalReturn =
      requestedQuantity ===
      availableQuantity;

    const originalSubtotal =
      decimalToNumber(
        saleDetail
          .subtotal_linea,
      );

    const originalDiscount =
      decimalToNumber(
        saleDetail
          .descuento_importe,
      );

    const originalTax =
      decimalToNumber(
        saleDetail
          .impuesto_importe,
      );

    const originalTotal =
      decimalToNumber(
        saleDetail
          .total_linea,
      );

    const returnedSubtotal =
      decimalToNumber(
        returned._sum
          .subtotal_linea ??
          0,
      );

    const returnedDiscount =
      decimalToNumber(
        returned._sum
          .descuento_importe ??
          0,
      );

    const returnedTax =
      decimalToNumber(
        returned._sum
          .impuesto_importe ??
          0,
      );

    const returnedTotal =
      decimalToNumber(
        returned._sum
          .total_linea ??
          0,
      );

    preparedItems.push({
      saleDetail,

      cantidad:
        requestedQuantity,

      subtotalLinea:
        calculatePartialAmount(
          originalSubtotal,
          returnedSubtotal,
          requestedQuantity,
          originalQuantity,
          isFinalReturn,
        ),

      descuentoImporte:
        calculatePartialAmount(
          originalDiscount,
          returnedDiscount,
          requestedQuantity,
          originalQuantity,
          isFinalReturn,
        ),

      impuestoImporte:
        calculatePartialAmount(
          originalTax,
          returnedTax,
          requestedQuantity,
          originalQuantity,
          isFinalReturn,
        ),

      totalLinea:
        calculatePartialAmount(
          originalTotal,
          returnedTotal,
          requestedQuantity,
          originalQuantity,
          isFinalReturn,
        ),
    });
  }

  const totals:
    ReturnTotals = {
      subtotal:
        roundMoney(
          preparedItems.reduce(
            (
              sum,
              item,
            ) =>
              sum +
              item.subtotalLinea,
            0,
          ),
        ),

      descuento:
        roundMoney(
          preparedItems.reduce(
            (
              sum,
              item,
            ) =>
              sum +
              item.descuentoImporte,
            0,
          ),
        ),

      impuesto:
        roundMoney(
          preparedItems.reduce(
            (
              sum,
              item,
            ) =>
              sum +
              item.impuestoImporte,
            0,
          ),
        ),

      total:
        roundMoney(
          preparedItems.reduce(
            (
              sum,
              item,
            ) =>
              sum +
              item.totalLinea,
            0,
          ),
        ),
    };

  return {
    preparedItems,
    totals,
  };
}