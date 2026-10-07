import type {
  Prisma,
} from "../../../generated/prisma/client.js";

import type {
  SaleTransaction,
} from "../types/sales.types.js";

interface CreateSaleAuditData {
  usuarioId: bigint;
  tabla: string;
  registroId: bigint;
  accion: "INSERT" | "UPDATE" | "DELETE";
  datosAnteriores?: Prisma.InputJsonValue;
  datosNuevos?: Prisma.InputJsonValue;
  ipOrigen?: string | null;
}

function normalizeIp(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  if (value.startsWith("::ffff:")) {
    return value.slice(7);
  }

  return value;
}

export const saleAuditRepository = {
  async create(
    tx: SaleTransaction,
    data: CreateSaleAuditData,
  ) {
    return tx.auditoria.create({
      data: {
        usuario_id:
          data.usuarioId,

        tabla:
          data.tabla,

        registro_id:
          data.registroId,

        accion:
          data.accion,

        ...(data.datosAnteriores !== undefined
          ? {
              datos_anteriores:
                data.datosAnteriores,
            }
          : {}),

        ...(data.datosNuevos !== undefined
          ? {
              datos_nuevos:
                data.datosNuevos,
            }
          : {}),

        ip_origen:
          normalizeIp(
            data.ipOrigen,
          ),
      },
    });
  },
};
