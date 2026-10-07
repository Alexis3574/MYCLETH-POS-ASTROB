import {
  SaleContextError,
} from "../../errors/sale.errors.js";

import {
  saleInventoryRepository,
} from "../../repositories/sale-inventory.repository.js";

import type {
  CreateSaleInput,
  SaleTransaction,
} from "../../types/sales.types.js";

import {
  decimalToNumber,
  roundMoney,
} from "../../utils/sale-money.js";

type ProductForSale =
  NonNullable<
    Awaited<
      ReturnType<
        typeof saleInventoryRepository.findProduct
      >
    >
  >;

export interface PreparedSaleDetail {
  product:
    ProductForSale;

  descripcion:
    string;

  cantidad:
    number;

  precioUnitario:
    number;

  costoUnitario:
    number;

  descuentoPorcentaje:
    number;

  tasaImpuesto:
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

export interface RequiredStock {
  productoId:
    bigint;

  sku:
    string;

  quantity:
    number;
}

export interface PreparedDetailsResult {
  preparedDetails:
    PreparedSaleDetail[];

  requiredStock:
    RequiredStock[];
}

export async function prepareSaleDetails(
  tx: SaleTransaction,
  input: CreateSaleInput,
): Promise<PreparedDetailsResult> {
  const preparedDetails:
    PreparedSaleDetail[] = [];

  const stockMap =
    new Map<
      string,
      RequiredStock
    >();

  for (const item of input.detalles) {
    const product =
      await saleInventoryRepository
        .findProduct(
          tx,
          input.empresaId,
          item.productoId,
        );

    if (!product) {
      throw new SaleContextError(
        "detalles.producto_id",
        `El producto ${item.productoId.toString()} no existe, está inactivo o no pertenece a la empresa.`,
      );
    }

    const quantity =
      Number(
        item.cantidad,
      );

    if (
      !Number.isFinite(
        quantity,
      ) ||
      quantity <= 0
    ) {
      throw new Error(
        `La cantidad del producto ${product.sku} no es válida.`,
      );
    }

    if (
      !product.unidad_medida
        .permite_decimales &&
      !Number.isInteger(
        quantity,
      )
    ) {
      throw new Error(
        `El producto ${product.sku} no permite cantidades decimales.`,
      );
    }

    if (
      product.controla_inventario &&
      !Number.isInteger(
        quantity,
      )
    ) {
      throw new Error(
        `El producto ${product.sku} no puede sincronizarse actualmente con el e-commerce porque utiliza una cantidad decimal.`,
      );
    }

    const precioUnitario =
      decimalToNumber(
        product.precio_venta,
      );

    const costoUnitario =
      decimalToNumber(
        product.costo_referencia,
      );

    let tasaImpuesto = 0;

    for (
      const relation of
      product.producto_impuesto
    ) {
      const tax =
        relation.impuesto;

      if (
        !tax.activo ||
        tax.empresa_id !==
          input.empresaId
      ) {
        continue;
      }

      tasaImpuesto +=
        decimalToNumber(
          tax.tasa,
        );
    }

    const subtotalLinea =
      roundMoney(
        quantity *
          precioUnitario,
      );

    const descuentoImporte =
      roundMoney(
        subtotalLinea *
          (
            item.descuentoPorcentaje /
            100
          ),
      );

    const baseGravable =
      roundMoney(
        subtotalLinea -
          descuentoImporte,
      );

    const impuestoImporte =
      roundMoney(
        baseGravable *
          (
            tasaImpuesto /
            100
          ),
      );

    const totalLinea =
      roundMoney(
        baseGravable +
          impuestoImporte,
      );

    preparedDetails.push({
      product,

      descripcion:
        item.descripcion ??
        product.nombre,

      cantidad:
        quantity,

      precioUnitario,

      costoUnitario,

      descuentoPorcentaje:
        item.descuentoPorcentaje,

      tasaImpuesto,

      subtotalLinea,

      descuentoImporte,

      impuestoImporte,

      totalLinea,
    });

    if (!product.controla_inventario) {
      continue;
    }

    const key =
      product.id.toString();

    const current =
      stockMap.get(key);

    if (current) {
      current.quantity +=
        quantity;

      continue;
    }

    stockMap.set(
      key,
      {
        productoId:
          product.id,

        sku:
          product.sku,

        quantity,
      },
    );
  }

  const requiredStock =
    Array.from(
      stockMap.values(),
    ).sort(
      (a, b) => {
        if (
          a.productoId <
          b.productoId
        ) {
          return -1;
        }

        if (
          a.productoId >
          b.productoId
        ) {
          return 1;
        }

        return 0;
      },
    );

  return {
    preparedDetails,
    requiredStock,
  };
}