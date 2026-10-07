import {
  prisma,
} from "../../lib/prisma.js";

interface SaleListFilters {
  folio?: string;
  estado?: string;
  condicionPago?: string;

  fechaDesde?: Date;
  fechaHasta?: Date;

  sucursalId?: bigint;
  almacenId?: bigint;
  clienteId?: bigint;
  usuarioId?: bigint;
}

interface FindManySalesParams {
  empresaId: bigint;
  skip: number;
  take: number;
  filters: SaleListFilters;
}

function buildSaleWhere(
  empresaId: bigint,
  filters: SaleListFilters,
) {
  const dateFilter =
    filters.fechaDesde ||
    filters.fechaHasta
      ? {
          ...(filters.fechaDesde
            ? {
                gte:
                  filters.fechaDesde,
              }
            : {}),

          ...(filters.fechaHasta
            ? {
                lte:
                  filters.fechaHasta,
              }
            : {}),
        }
      : undefined;

  return {
    empresa_id:
      empresaId,

    ...(filters.folio
      ? {
          folio: {
            contains:
              filters.folio,

            mode:
              "insensitive" as const,
          },
        }
      : {}),

    ...(filters.estado
      ? {
          estado:
            filters.estado,
        }
      : {}),

    ...(filters.condicionPago
      ? {
          condicion_pago:
            filters.condicionPago,
        }
      : {}),

    ...(dateFilter
      ? {
          fecha:
            dateFilter,
        }
      : {}),

    ...(filters.sucursalId
      ? {
          sucursal_id:
            filters.sucursalId,
        }
      : {}),

    ...(filters.almacenId
      ? {
          almacen_id:
            filters.almacenId,
        }
      : {}),

    ...(filters.clienteId
      ? {
          cliente_id:
            filters.clienteId,
        }
      : {}),

    ...(filters.usuarioId
      ? {
          usuario_id:
            filters.usuarioId,
        }
      : {}),
  };
}

export const saleQueryRepository = {
  async findUserCompany(
    userId: bigint,
  ) {
    return prisma.usuario.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,
        empresa_id: true,
        activo: true,
        bloqueado: true,
      },
    });
  },

  async countByCompany(
    empresaId: bigint,
    filters: SaleListFilters,
  ) {
    return prisma.venta.count({
      where:
        buildSaleWhere(
          empresaId,
          filters,
        ),
    });
  },

  async findManyByCompany({
    empresaId,
    skip,
    take,
    filters,
  }: FindManySalesParams) {
    return prisma.venta.findMany({
      where:
        buildSaleWhere(
          empresaId,
          filters,
        ),

      orderBy: [
        {
          fecha: "desc",
        },
        {
          id: "desc",
        },
      ],

      skip,
      take,

      select: {
        id: true,
        folio: true,
        fecha: true,
        condicion_pago: true,
        estado: true,

        subtotal: true,
        descuento: true,
        impuesto: true,
        total: true,

        creado_en: true,
        actualizado_en: true,

        sucursal: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
          },
        },

        almacen: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
          },
        },

        cliente: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
          },
        },

        usuario: {
          select: {
            id: true,
            username: true,
            nombre: true,
            apellido: true,
          },
        },
      },
    });
  },

  async findById(
    empresaId: bigint,
    saleId: bigint,
  ) {
    return prisma.venta.findFirst({
      where: {
        id: saleId,
        empresa_id: empresaId,
      },

      select: {
        id: true,
        empresa_id: true,
        sucursal_id: true,
        almacen_id: true,
        cliente_id: true,
        usuario_id: true,
        sesion_caja_id: true,
        cotizacion_id: true,
        orden_venta_id: true,
        pedido_cliente_id: true,

        folio: true,
        fecha: true,
        condicion_pago: true,
        estado: true,

        subtotal: true,
        descuento: true,
        impuesto: true,
        total: true,

        observaciones: true,

        creado_en: true,
        actualizado_en: true,

        empresa: {
          select: {
            id: true,
            nombre_comercial: true,
          },
        },

        sucursal: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
          },
        },

        almacen: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
          },
        },

        cliente: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
            email: true,
            telefono: true,
          },
        },

        usuario: {
          select: {
            id: true,
            username: true,
            nombre: true,
            apellido: true,
          },
        },

        sesion_caja: {
          select: {
            id: true,
            estado: true,
            fecha_apertura: true,
            fecha_cierre: true,

            caja: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
              },
            },
          },
        },

        venta_detalle: {
          orderBy: {
            id: "asc",
          },

          select: {
            id: true,
            producto_id: true,
            descripcion: true,
            cantidad: true,
            precio_unitario: true,
            costo_unitario: true,
            descuento_porcentaje: true,
            tasa_impuesto: true,
            subtotal_linea: true,
            descuento_importe: true,
            impuesto_importe: true,
            total_linea: true,

            producto: {
              select: {
                id: true,
                sku: true,
                codigo_barras: true,
                nombre: true,
              },
            },
          },
        },

        venta_pago: {
          orderBy: {
            id: "asc",
          },

          select: {
            id: true,
            monto: true,
            referencia: true,
            fecha: true,

            metodo_pago: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
                es_efectivo: true,
              },
            },
          },
        },
      },
    });
  },
};