import type { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../../lib/prisma.js";
import {
  EcommerceSyncError,
  type SyncActor
} from "./ecommerce-sync.service.js";

export const ecommerceSyncRetryService = {
  async authorize(actor: SyncActor, id: bigint) {
    return prisma.$transaction(async tx => {
      const user = await tx.usuario.findFirst({
        where: {
          id: actor.userId,
          empresa_id: actor.empresaId,
          activo: true,
          bloqueado: false,
          empresa: { activo: true }
        },
        select: { id: true }
      });

      if (!user) {
        throw new EcommerceSyncError(
          403,
          "ECOMMERCE_SYNC_FORBIDDEN",
          "Usuario no autorizado."
        );
      }

      const scope: Prisma.sincronizacion_ecommerce_inventarioWhereInput = {
        id,
        movimiento_inventario: {
          is: {
            producto: {
              is: { empresa_id: actor.empresaId }
            },
            almacen: {
              is: {
                sucursal: {
                  is: {
                    empresa_id: actor.empresaId,
                    usuario_sucursal: {
                      some: { usuario_id: actor.userId }
                    }
                  }
                }
              }
            }
          }
        }
      };

      const event =
        await tx.sincronizacion_ecommerce_inventario.findFirst({
          where: scope,
          select: {
            id: true,
            estado: true,
            intentos: true,
            operation_id: true
          }
        });

      if (!event) {
        throw new EcommerceSyncError(
          404,
          "ECOMMERCE_SYNC_NOT_FOUND",
          "Evento no encontrado."
        );
      }

      if (event.estado !== "AGOTADO") {
        throw new EcommerceSyncError(
          409,
          "ECOMMERCE_SYNC_INVALID_STATE",
          "Solo se permite reintentar eventos agotados."
        );
      }

      const updated =
        await tx.sincronizacion_ecommerce_inventario.updateMany({
          where: {
            AND: [
              scope,
              {
                estado: "AGOTADO",
                intentos: event.intentos
              }
            ]
          },
          data: { estado: "REINTENTO_MANUAL" }
        });

      if (updated.count !== 1) {
        throw new EcommerceSyncError(
          409,
          "ECOMMERCE_SYNC_CONFLICT",
          "Otro proceso modificó el evento."
        );
      }

      await tx.auditoria.create({
        data: {
          usuario_id: actor.userId,
          tabla: "sincronizacion_ecommerce_inventario",
          registro_id: event.id,
          accion: "UPDATE",
          datos_anteriores: {
            estado: "AGOTADO",
            intentos: event.intentos
          },
          datos_nuevos: {
            modulo: "ECOMMERCE_SYNC",
            accion: "AUTORIZAR_REINTENTO",
            estado: "REINTENTO_MANUAL",
            intentos: event.intentos,
            operation_id: event.operation_id
          }
        }
      });

      return {
        id: event.id.toString(),
        estado: "REINTENTO_MANUAL" as const,
        intentos: event.intentos
      };
    });
  }
};
