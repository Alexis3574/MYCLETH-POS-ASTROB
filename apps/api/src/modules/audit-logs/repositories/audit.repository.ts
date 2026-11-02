import { Prisma } from "../../../generated/prisma/client.js";
import { auditSource } from "./audit-targets.js";

import type {
  AuditActor,
  AuditDatabaseRow,
  AuditDetailRow,
  AuditCountRow
} from "../types/audit.types.js";

import type {
  BranchAccess
} from "../../inventory/authorization/branch-access.js";

import type {
  AuditListQuery
} from "../validators/audit.schema.js";

type Tx = Prisma.TransactionClient;

const source = auditSource;

export function auditScope(
  actor: AuditActor,
  access: BranchAccess,
  query?: AuditListQuery,
  auditId?: bigint
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`u.empresa_id = ${actor.empresaId}`,
    Prisma.sql`target.empresa_id = ${actor.empresaId}`
  ];

  if (!access.global) {
    conditions.push(Prisma.sql`target.solo_admin = FALSE`);

    if (access.sucursalIds.length === 0) {
      conditions.push(Prisma.sql`FALSE`);
    } else {
      const ids = Prisma.join(access.sucursalIds);

      conditions.push(
        Prisma.sql`target.sucursal_id IN (${ids})`
      );

      conditions.push(
        Prisma.sql`(
          target.sucursal_destino_id IS NULL
          OR target.sucursal_destino_id IN (${ids})
        )`
      );
    }
  }

  if (auditId !== undefined) {
    conditions.push(Prisma.sql`a.id = ${auditId}`);
  }

  if (query?.usuario_id !== undefined) {
    conditions.push(
      Prisma.sql`a.usuario_id = ${query.usuario_id}`
    );
  }

  if (query?.usuario) {
    conditions.push(
      Prisma.sql`
        strpos(
          lower(u.username),
          lower(${query.usuario})
        ) > 0
      `
    );
  }

  if (query?.tabla) {
    conditions.push(
      Prisma.sql`a.tabla = ${query.tabla}`
    );
  }

  if (query?.registro_id !== undefined) {
    conditions.push(
      Prisma.sql`a.registro_id = ${query.registro_id}`
    );
  }

  if (query?.accion) {
    conditions.push(
      Prisma.sql`a.accion = ${query.accion}`
    );
  }

  if (query?.fecha_desde) {
    conditions.push(
      Prisma.sql`a.creado_en >= ${query.fecha_desde}`
    );
  }

  if (query?.fecha_hasta) {
    conditions.push(
      Prisma.sql`a.creado_en <= ${query.fecha_hasta}`
    );
  }

  if (query?.q) {
    conditions.push(
      Prisma.sql`
        (
          strpos(lower(a.tabla), lower(${query.q})) > 0
          OR strpos(lower(a.accion), lower(${query.q})) > 0
          OR strpos(lower(u.username), lower(${query.q})) > 0
        )
      `
    );
  }

  return Prisma.sql`
    WHERE ${Prisma.join(conditions, " AND ")}
  `;
}

export const auditRepository = {
  async list(
    tx: Tx,
    actor: AuditActor,
    access: BranchAccess,
    query: AuditListQuery
  ) {
    const filter = auditScope(actor, access, query);

    const count = await tx.$queryRaw<AuditCountRow[]>(
      Prisma.sql`
        SELECT COUNT(*) AS total
        ${source}
        ${filter}
      `
    );

    const offset = (query.page - 1) * query.limit;

    const rows = await tx.$queryRaw<AuditDatabaseRow[]>(
      Prisma.sql`
        SELECT
          a.id,
          a.usuario_id,
          a.tabla,
          a.registro_id,
          a.accion,
          a.creado_en,
          target.sucursal_id,
          u.username
        ${source}
        ${filter}
        ORDER BY a.creado_en DESC, a.id DESC
        LIMIT ${query.limit}
        OFFSET ${offset}
      `
    );

    return {
      rows,
      total: count[0]?.total ?? 0n
    };
  },

  async getById(
    tx: Tx,
    actor: AuditActor,
    access: BranchAccess,
    id: bigint
  ) {
    const filter = auditScope(actor, access, undefined, id);

    const rows = await tx.$queryRaw<AuditDetailRow[]>(
      Prisma.sql`
        SELECT
          a.id,
          a.usuario_id,
          a.tabla,
          a.registro_id,
          a.accion,
          a.creado_en,
          a.datos_anteriores,
          a.datos_nuevos,
          target.sucursal_id,
          u.username
        ${source}
        ${filter}
        LIMIT 1
      `
    );

    return rows[0] ?? null;
  }
};
