import { prisma } from "../../../lib/prisma.js";
import { transferRepository as transfers } from "../repositories/transfer.repository.js";
import { transferMovementRepository as movements } from "../repositories/transfer-movement.repository.js";
import { transferOperationRepository as operations } from "../repositories/transfer-operation.repository.js";
import { transferNotFound } from "../errors/transfer.errors.js";
import type { TransferActor, TransferQuery } from "../types/transfer.types.js";
import { loadBranchAccess } from "../../inventory/authorization/branch-access.js";
import { serializeTransfer, serializeTransferMovements, serializeTransferSummary } from "../utils/transfer.serializer.js";
import { pagination } from "../../inventory/utils/inventory.serializer.js";

export const transferQueryService = {
  list(actor: TransferActor, query: TransferQuery) {
    return prisma.$transaction(async (tx) => {
      const access = await loadBranchAccess(tx, actor);
      const result = await transfers.list(tx, access, query);
      return { data: result.rows.map(serializeTransferSummary), pagination: pagination(query.page, query.limit, result.total) };
    }, { isolationLevel: "RepeatableRead" });
  },
  get(actor: TransferActor, id: bigint) {
    return prisma.$transaction(async (tx) => {
      const access = await loadBranchAccess(tx, actor);
      const row = await transfers.findVisible(tx, access, id);
      if (!row) throw transferNotFound();
      const history = await operations.history(tx, actor.empresaId, id);
      return { ...serializeTransfer(row), movimientos: serializeTransferMovements(await movements.list(tx, actor.empresaId, id)),
        operaciones: history.map((operation) => ({ id: operation.id.toString(), usuario_id: operation.usuario_id.toString(),
          accion: operation.accion, fecha: operation.creado_en.toISOString() })),
        ecommerce: { eventos_creados_por_este_modulo: 0, politica: "SIN_EVENTOS_ALMACENES_PENDIENTES" } };
    }, { isolationLevel: "RepeatableRead" });
  },
};
