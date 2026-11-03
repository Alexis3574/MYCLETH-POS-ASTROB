import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../../lib/prisma.js";

import {
  loadBranchAccess
} from "../../inventory/authorization/branch-access.js";

import {
  auditRepository
} from "../repositories/audit.repository.js";

import {
  AuditNotFoundError
} from "../errors/audit.errors.js";

import {
  redactAuditPayload
} from "../utils/audit-redaction.js";

import type {
  AuditActor,
  AuditDatabaseRow
} from "../types/audit.types.js";

import type {
  AuditListQuery
} from "../validators/audit.schema.js";

function serializeRow(row: AuditDatabaseRow) {
  return {
    id: row.id.toString(),
    usuario_id: row.usuario_id.toString(),
    usuario: {
      id: row.usuario_id.toString(),
      username: row.username
    },
    tabla: row.tabla,
    registro_id: row.registro_id?.toString() ?? null,
    accion: row.accion,
    sucursal_id: row.sucursal_id?.toString() ?? null,
    creado_en: row.creado_en
  };
}

export const auditService = {
  async list(actor: AuditActor, query: AuditListQuery) {
    return prisma.$transaction(async tx => {
      const access = await loadBranchAccess(tx, actor);

      const { rows, total } = await auditRepository.list(
        tx,
        actor,
        access,
        query
      );

      const safeTotal =
        total <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(total)
          : total.toString();

      return {
        data: rows.map(serializeRow),
        pagination: {
          page: query.page,
          limit: query.limit,
          total: safeTotal,
          total_pages: Number(
            (total + BigInt(query.limit) - 1n) /
            BigInt(query.limit)
          )
        }
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
    });
  },

  async getById(actor: AuditActor, id: bigint) {
    return prisma.$transaction(async tx => {
      const access = await loadBranchAccess(tx, actor);

      const record = await auditRepository.getById(
        tx,
        actor,
        access,
        id
      );

      if (!record) {
        throw new AuditNotFoundError();
      }

      return {
        ...serializeRow(record),
        datos_anteriores: redactAuditPayload(
          record.tabla,
          record.datos_anteriores
        ),
        datos_nuevos: redactAuditPayload(
          record.tabla,
          record.datos_nuevos
        )
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
    });
  }
};
