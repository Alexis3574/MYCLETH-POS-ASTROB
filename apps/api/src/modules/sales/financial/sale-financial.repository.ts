import {
  prisma,
} from "../../../lib/prisma.js";

export const saleFinancialRepository = {
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
        folio: true,
        fecha: true,
        estado: true,
        condicion_pago: true,
        total: true,

        cliente: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
            limite_credito: true,
            dias_credito: true,
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

            metodo_pago: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
                es_efectivo: true,
              },
            },

            devolucion_pago: {
              select: {
                monto: true,
              },
            },
          },
        },
      },
    });
  },
};
