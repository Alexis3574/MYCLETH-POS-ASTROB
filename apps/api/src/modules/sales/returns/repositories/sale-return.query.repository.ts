import {
  prisma,
} from "../../../../lib/prisma.js";

export const saleReturnQueryRepository = {
  async findSale(
    saleId: bigint,
    empresaId: bigint,
  ) {
    return prisma.venta.findFirst({
      where: {
        id: saleId,
        empresa_id: empresaId,
      },

      select: {
        id: true,
        folio: true,
        estado: true,
        fecha: true,
        total: true,
      },
    });
  },

  async summarizeBySale(
    saleId: bigint,
  ) {
    return prisma.devolucion_venta.aggregate({
      where: {
        venta_id: saleId,
      },

      _count: {
        _all: true,
      },

      _sum: {
        total: true,
      },
    });
  },

  async listBySale(
    saleId: bigint,
  ) {
    return prisma.devolucion_venta.findMany({
      where: {
        venta_id: saleId,
      },

      orderBy: {
        fecha: "desc",
      },

      select: {
        id: true,
        venta_id: true,
        usuario_id: true,
        sesion_caja_id: true,
        folio: true,
        motivo: true,
        subtotal: true,
        descuento: true,
        impuesto: true,
        total: true,
        fecha: true,
        creado_en: true,

        usuario: {
          select: {
            id: true,
            username: true,
            nombre: true,
            apellido: true,
          },
        },

        devolucion_venta_detalle: {
          orderBy: {
            id: "asc",
          },

          select: {
            id: true,
            venta_detalle_id: true,
            cantidad: true,
            subtotal_linea: true,
            descuento_importe: true,
            impuesto_importe: true,
            total_linea: true,

            venta_detalle: {
              select: {
                producto_id: true,
                descripcion: true,
                precio_unitario: true,
                costo_unitario: true,

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
          },
        },

        devolucion_pago: {
          orderBy: {
            id: "asc",
          },

          select: {
            id: true,
            venta_pago_id: true,
            sesion_caja_id: true,
            monto: true,
            referencia: true,
            fecha: true,

            venta_pago: {
              select: {
                metodo_pago_id: true,
                monto: true,
                referencia: true,

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
        },
      },
    });
  },

  async findById(
    saleId: bigint,
    returnId: bigint,
  ) {
    return prisma.devolucion_venta.findFirst({
      where: {
        id: returnId,
        venta_id: saleId,
      },

      select: {
        id: true,
        venta_id: true,
        usuario_id: true,
        sesion_caja_id: true,
        folio: true,
        motivo: true,
        subtotal: true,
        descuento: true,
        impuesto: true,
        total: true,
        fecha: true,
        creado_en: true,
        actualizado_en: true,

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

            caja: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
              },
            },
          },
        },

        devolucion_venta_detalle: {
          orderBy: {
            id: "asc",
          },

          select: {
            id: true,
            venta_detalle_id: true,
            cantidad: true,
            subtotal_linea: true,
            descuento_importe: true,
            impuesto_importe: true,
            total_linea: true,

            venta_detalle: {
              select: {
                producto_id: true,
                descripcion: true,
                cantidad: true,
                precio_unitario: true,
                costo_unitario: true,
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
          },
        },

        devolucion_pago: {
          orderBy: {
            id: "asc",
          },

          select: {
            id: true,
            venta_pago_id: true,
            sesion_caja_id: true,
            monto: true,
            referencia: true,
            fecha: true,

            venta_pago: {
              select: {
                metodo_pago_id: true,
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
        },
      },
    });
  },
};