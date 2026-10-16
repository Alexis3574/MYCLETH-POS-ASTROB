import { prisma } from "../../../lib/prisma.js";
import { transferRepository as transfers } from "../repositories/transfer.repository.js";
import { transferMovementRepository as movements } from "../repositories/transfer-movement.repository.js";
import { transferOperationRepository as operations } from "../repositories/transfer-operation.repository.js";
import { transferNotFound } from "../errors/transfer.errors.js";
import type { TransferQuery } from "../types/transfer.types.js";
import { serializeTransfer, serializeTransferMovements, serializeTransferSummary } from "../utils/transfer.serializer.js";
import { pagination } from "../../inventory/utils/inventory.serializer.js";

export const transferQueryService = {
  list(empresaId: bigint, query: TransferQuery) {
    return prisma.$transaction(async (tx) => {
      const result = await transfers.list(tx, empresaId, query);
      return { data: result.rows.map(serializeTransferSummary), pagination: pagination(query.page, query.limit, result.total) };
    }, { isolationLevel: "RepeatableRead" });
  },
  get(empresaId: bigint, id: bigint) {
    return prisma.$transaction(async (tx) => {
      const row = await transfers.find(tx, empresaId, id);
      if (!row) throw transferNotFound();
      const history = await operations.history(tx, empresaId, id);
      return { ...serializeTransfer(row), movimientos: serializeTransferMovements(await movements.list(tx, empresaId, id)),
        operaciones: history.map((operation) => ({ id: operation.id.toString(), usuario_id: operation.usuario_id.toString(),
          accion: operation.accion, fecha: operation.creado_en.toISOString() })),
        ecommerce: { eventos_creados_por_este_modulo: 0, politica: "SIN_EVENTOS_ALMACENES_PENDIENTES" } };
    }, { isolationLevel: "RepeatableRead" });
  },
};
