import {
  saleReturnQueryService,
} from "./returns/services/sale-return.query.service.js";

import type {
  ListSalesQueryInput,
} from "./sale.query.schema.js";

import {
  saleQueryRepository,
} from "./sale.query.repository.js";

function decimalToNumber(
  value: unknown,
): number {
  const result =
    Number(value);

  if (
    !Number.isFinite(
      result,
    )
  ) {
    throw new Error(
      "Se encontró un valor numérico inválido en la venta.",
    );
  }

  return result;
}

export class SaleQueryAccessError extends Error {
  readonly code =
    "SALE_QUERY_ACCESS_DENIED";

  constructor() {
    super(
      "El usuario no está disponible para consultar ventas.",
    );

    this.name =
      "SaleQueryAccessError";
  }
}

export class SaleQueryNotFoundError extends Error {
  readonly code =
    "SALE_NOT_FOUND";

  constructor() {
    super(
      "Venta no encontrada.",
    );

    this.name =
      "SaleQueryNotFoundError";
  }
}

export const saleQueryService = {
  async listSales(
    userId: bigint,
    query:
      ListSalesQueryInput,
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

    const page =
      query.page;

    const limit =
      query.limit;

    const skip =
      (
        page -
        1
      ) *
      limit;

    const filters = {
      folio:
        query.folio,

      estado:
        query.estado,

      condicionPago:
        query.condicion_pago,

      fechaDesde:
        query.fecha_desde,

      fechaHasta:
        query.fecha_hasta,

      sucursalId:
        query.sucursal_id,

      almacenId:
        query.almacen_id,

      clienteId:
        query.cliente_id,

      usuarioId:
        query.usuario_id,
    };

    const [
      sales,
      total,
    ] =
      await Promise.all([
        saleQueryRepository
          .findManyByCompany({
            empresaId:
              user.empresa_id,

            skip,

            take:
              limit,

            filters,
          }),

        saleQueryRepository
          .countByCompany(
            user.empresa_id,
            filters,
          ),
      ]);

    return {
      sales:
        sales.map(
          (sale) => ({
            id:
              sale.id.toString(),

            folio:
              sale.folio,

            fecha:
              sale.fecha,

            condicion_pago:
              sale.condicion_pago,

            estado:
              sale.estado,

            subtotal:
              decimalToNumber(
                sale.subtotal,
              ),

            descuento:
              decimalToNumber(
                sale.descuento,
              ),

            impuesto:
              decimalToNumber(
                sale.impuesto,
              ),

            total:
              decimalToNumber(
                sale.total,
              ),

            sucursal: {
              id:
                sale.sucursal.id
                  .toString(),

              codigo:
                sale.sucursal.codigo,

              nombre:
                sale.sucursal.nombre,
            },

            almacen: {
              id:
                sale.almacen.id
                  .toString(),

              codigo:
                sale.almacen.codigo,

              nombre:
                sale.almacen.nombre,
            },

            cliente:
              sale.cliente
                ? {
                    id:
                      sale.cliente.id
                        .toString(),

                    codigo:
                      sale.cliente.codigo,

                    nombre:
                      sale.cliente.nombre,
                  }
                : null,

            usuario: {
              id:
                sale.usuario.id
                  .toString(),

              username:
                sale.usuario.username,

              nombre:
                sale.usuario.nombre,

              apellido:
                sale.usuario.apellido,
            },

            creado_en:
              sale.creado_en,

            actualizado_en:
              sale.actualizado_en,
          }),
        ),

      pagination: {
        page,

        limit,

        total,

        totalPages:
          Math.ceil(
            total /
            limit,
          ),
      },
    };
  },

  async getSaleById(
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
      await saleQueryRepository
        .findById(
          user.empresa_id,
          saleId,
        );

    if (!sale) {
      throw new SaleQueryNotFoundError();
    }

    const returnSummary =
      await saleReturnQueryService
        .getSummary(
          saleId,
        );

    return {
      id:
        sale.id.toString(),

      empresa_id:
        sale.empresa_id.toString(),

      sucursal_id:
        sale.sucursal_id.toString(),

      almacen_id:
        sale.almacen_id.toString(),

      cliente_id:
        sale.cliente_id === null
          ? null
          : sale.cliente_id.toString(),

      usuario_id:
        sale.usuario_id.toString(),

      sesion_caja_id:
        sale.sesion_caja_id === null
          ? null
          : sale.sesion_caja_id.toString(),

      cotizacion_id:
        sale.cotizacion_id === null
          ? null
          : sale.cotizacion_id.toString(),

      orden_venta_id:
        sale.orden_venta_id === null
          ? null
          : sale.orden_venta_id.toString(),

      pedido_cliente_id:
        sale.pedido_cliente_id === null
          ? null
          : sale.pedido_cliente_id.toString(),

      folio:
        sale.folio,

      fecha:
        sale.fecha,

      condicion_pago:
        sale.condicion_pago,

      estado:
        sale.estado,

      subtotal:
        decimalToNumber(
          sale.subtotal,
        ),

      descuento:
        decimalToNumber(
          sale.descuento,
        ),

      impuesto:
        decimalToNumber(
          sale.impuesto,
        ),

      total:
        decimalToNumber(
          sale.total,
        ),

      observaciones:
        sale.observaciones,

      empresa: {
        id:
          sale.empresa.id
            .toString(),

        nombre:
          sale.empresa
            .nombre_comercial,
      },

      sucursal: {
        id:
          sale.sucursal.id
            .toString(),

        codigo:
          sale.sucursal.codigo,

        nombre:
          sale.sucursal.nombre,
      },

      almacen: {
        id:
          sale.almacen.id
            .toString(),

        codigo:
          sale.almacen.codigo,

        nombre:
          sale.almacen.nombre,
      },

      cliente:
        sale.cliente
          ? {
              id:
                sale.cliente.id
                  .toString(),

              codigo:
                sale.cliente.codigo,

              nombre:
                sale.cliente.nombre,

              email:
                sale.cliente.email,

              telefono:
                sale.cliente.telefono,
            }
          : null,

      usuario: {
        id:
          sale.usuario.id
            .toString(),

        username:
          sale.usuario.username,

        nombre:
          sale.usuario.nombre,

        apellido:
          sale.usuario.apellido,
      },

      sesion_caja:
        sale.sesion_caja
          ? {
              id:
                sale.sesion_caja.id
                  .toString(),

              estado:
                sale.sesion_caja.estado,

              fecha_apertura:
                sale.sesion_caja
                  .fecha_apertura,

              fecha_cierre:
                sale.sesion_caja
                  .fecha_cierre,

              caja: {
                id:
                  sale.sesion_caja
                    .caja.id
                    .toString(),

                codigo:
                  sale.sesion_caja
                    .caja.codigo,

                nombre:
                  sale.sesion_caja
                    .caja.nombre,
              },
            }
          : null,

      detalles:
        sale.venta_detalle.map(
          (detail) => ({
            id:
              detail.id.toString(),

            producto_id:
              detail.producto_id
                .toString(),

            descripcion:
              detail.descripcion,

            cantidad:
              decimalToNumber(
                detail.cantidad,
              ),

            precio_unitario:
              decimalToNumber(
                detail.precio_unitario,
              ),

            costo_unitario:
              detail.costo_unitario ===
              null
                ? null
                : decimalToNumber(
                    detail.costo_unitario,
                  ),

            descuento_porcentaje:
              decimalToNumber(
                detail.descuento_porcentaje,
              ),

            tasa_impuesto:
              decimalToNumber(
                detail.tasa_impuesto,
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
                detail.producto.id
                  .toString(),

              sku:
                detail.producto.sku,

              codigo_barras:
                detail.producto
                  .codigo_barras,

              nombre:
                detail.producto.nombre,
            },
          }),
        ),

      pagos:
        sale.venta_pago.map(
          (payment) => ({
            id:
              payment.id.toString(),

            monto:
              decimalToNumber(
                payment.monto,
              ),

            referencia:
              payment.referencia,

            fecha:
              payment.fecha,

            metodo_pago: {
              id:
                payment.metodo_pago.id
                  .toString(),

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
          }),
        ),

      devoluciones:
        returnSummary,

      creado_en:
        sale.creado_en,

      actualizado_en:
        sale.actualizado_en,
    };
  },
};