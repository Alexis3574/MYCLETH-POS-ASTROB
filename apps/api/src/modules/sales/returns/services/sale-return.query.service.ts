import {
  SaleReturnQueryNotFoundError,
  SaleReturnQuerySaleNotFoundError,
} from "../errors/sale-return.errors.js";

import {
  saleReturnQueryRepository,
} from "../repositories/sale-return.query.repository.js";

import {
  decimalToNumber,
  roundMoney,
} from "../../utils/sale-money.js";

type ReturnListResult =
  Awaited<
    ReturnType<
      typeof saleReturnQueryRepository.listBySale
    >
  >;

type ReturnListRecord =
  ReturnListResult[number];

type ReturnDetailRecord =
  NonNullable<
    Awaited<
      ReturnType<
        typeof saleReturnQueryRepository.findById
      >
    >
  >;

type ReturnRecord =
  | ReturnListRecord
  | ReturnDetailRecord;

function mapSaleReturn(
  record: ReturnRecord,
) {
  return {
    id:
      record.id.toString(),

    venta_id:
      record.venta_id.toString(),

    usuario_id:
      record.usuario_id.toString(),

    sesion_caja_id:
      record.sesion_caja_id?.toString() ??
      null,

    folio:
      record.folio,

    motivo:
      record.motivo,

    subtotal:
      decimalToNumber(
        record.subtotal,
      ),

    descuento:
      decimalToNumber(
        record.descuento,
      ),

    impuesto:
      decimalToNumber(
        record.impuesto,
      ),

    total:
      decimalToNumber(
        record.total,
      ),

    fecha:
      record.fecha,

    creado_en:
      record.creado_en,

    usuario: {
      id:
        record.usuario.id.toString(),

      username:
        record.usuario.username,

      nombre:
        record.usuario.nombre,

      apellido:
        record.usuario.apellido,
    },

    sesion_caja:
      "sesion_caja" in record
        ? record.sesion_caja === null
          ? null
          : {
              id:
                record.sesion_caja.id
                  .toString(),

              estado:
                record.sesion_caja.estado,

              caja: {
                id:
                  record.sesion_caja.caja.id
                    .toString(),

                codigo:
                  record.sesion_caja.caja
                    .codigo,

                nombre:
                  record.sesion_caja.caja
                    .nombre,
              },
            }
        : undefined,

    detalles:
      record.devolucion_venta_detalle.map(
        (detail) => ({
          id:
            detail.id.toString(),

          venta_detalle_id:
            detail.venta_detalle_id
              .toString(),

          cantidad:
            decimalToNumber(
              detail.cantidad,
            ),

          subtotal_linea:
            decimalToNumber(
              detail.subtotal_linea,
            ),

          descuento_importe:
            decimalToNumber(
              detail.descuento_importe,
            ),

          impuesto_importe:
            decimalToNumber(
              detail.impuesto_importe,
            ),

          total_linea:
            decimalToNumber(
              detail.total_linea,
            ),

          producto: {
            id:
              detail.venta_detalle
                .producto.id
                .toString(),

            sku:
              detail.venta_detalle
                .producto.sku,

            codigo_barras:
              detail.venta_detalle
                .producto
                .codigo_barras,

            nombre:
              detail.venta_detalle
                .producto.nombre,
          },

          venta_original: {
            descripcion:
              detail.venta_detalle
                .descripcion,

            precio_unitario:
              decimalToNumber(
                detail.venta_detalle
                  .precio_unitario,
              ),

            costo_unitario:
              detail.venta_detalle
                .costo_unitario ===
              null
                ? null
                : decimalToNumber(
                    detail.venta_detalle
                      .costo_unitario,
                  ),
          },
        }),
      ),

    reembolsos:
      record.devolucion_pago.map(
        (refund) => ({
          id:
            refund.id.toString(),

          venta_pago_id:
            refund.venta_pago_id
              .toString(),

          sesion_caja_id:
            refund.sesion_caja_id
              ?.toString() ??
            null,

          monto:
            decimalToNumber(
              refund.monto,
            ),

          referencia:
            refund.referencia,

          fecha:
            refund.fecha,

          metodo_pago: {
            id:
              refund.venta_pago
                .metodo_pago.id
                .toString(),

            codigo:
              refund.venta_pago
                .metodo_pago.codigo,

            nombre:
              refund.venta_pago
                .metodo_pago.nombre,

            es_efectivo:
              refund.venta_pago
                .metodo_pago
                .es_efectivo,
          },

          pago_original: {
            monto:
              decimalToNumber(
                refund.venta_pago
                  .monto,
              ),

            referencia:
              refund.venta_pago
                .referencia,
          },
        }),
      ),
  };
}

export const saleReturnQueryService = {
  async getSummary(
    saleId: bigint,
  ) {
    const summary =
      await saleReturnQueryRepository
        .summarizeBySale(
          saleId,
        );

    const totalDevoluciones =
      summary._count._all;

    const totalDevuelto =
      summary._sum.total === null
        ? 0
        : roundMoney(
            decimalToNumber(
              summary._sum.total,
            ),
          );

    return {
      tiene_devoluciones:
        totalDevoluciones > 0,

      total_devoluciones:
        totalDevoluciones,

      total_devuelto:
        totalDevuelto,
    };
  },

  async list(
    saleId: bigint,
    empresaId: bigint,
  ) {
    const sale =
      await saleReturnQueryRepository
        .findSale(
          saleId,
          empresaId,
        );

    if (!sale) {
      throw new SaleReturnQuerySaleNotFoundError();
    }

    const records =
      await saleReturnQueryRepository
        .listBySale(
          saleId,
        );

    const totalDevuelto =
      roundMoney(
        records.reduce(
          (
            accumulated,
            record,
          ) =>
            accumulated +
            decimalToNumber(
              record.total,
            ),
          0,
        ),
      );

    return {
      venta: {
        id:
          sale.id.toString(),

        folio:
          sale.folio,

        estado:
          sale.estado,

        fecha:
          sale.fecha,

        total:
          decimalToNumber(
            sale.total,
          ),
      },

      total_devoluciones:
        records.length,

      total_devuelto:
        totalDevuelto,

      devoluciones:
        records.map(
          (record) =>
            mapSaleReturn(
              record,
            ),
        ),
    };
  },

  async getById(
    saleId: bigint,
    returnId: bigint,
    empresaId: bigint,
  ) {
    const sale =
      await saleReturnQueryRepository
        .findSale(
          saleId,
          empresaId,
        );

    if (!sale) {
      throw new SaleReturnQuerySaleNotFoundError();
    }

    const record =
      await saleReturnQueryRepository
        .findById(
          saleId,
          returnId,
        );

    if (!record) {
      throw new SaleReturnQueryNotFoundError();
    }

    return {
      venta: {
        id:
          sale.id.toString(),

        folio:
          sale.folio,

        estado:
          sale.estado,

        fecha:
          sale.fecha,

        total:
          decimalToNumber(
            sale.total,
          ),
      },

      devolucion:
        mapSaleReturn(
          record,
        ),
    };
  },
};