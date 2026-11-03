import type { Prisma } from "../../../generated/prisma/client.js";

type Tx = Prisma.TransactionClient;
export interface BranchActor { empresaId: bigint; userId: bigint }
export interface BranchAccess { empresaId: bigint; global: boolean; sucursalIds: bigint[] }

/** Evaluado en cada operación; nunca confiar en sucursales incluidas en el JWT. */
export async function loadBranchAccess(tx: Tx, actor: BranchActor): Promise<BranchAccess> {
  const administrator = await tx.usuario_rol.findFirst({
    where: {
      usuario_id: actor.userId,
      usuario: { empresa_id: actor.empresaId, activo: true, bloqueado: false, empresa: { activo: true } },
      rol: { codigo: "ADMIN", activo: true },
    },
    select: { usuario_id: true },
  });
  if (administrator) return { empresaId: actor.empresaId, global: true, sucursalIds: [] };

  const assignments = await tx.usuario_sucursal.findMany({
    where: {
      usuario_id: actor.userId,
      usuario: { empresa_id: actor.empresaId, activo: true, bloqueado: false, empresa: { activo: true } },
      sucursal: { empresa_id: actor.empresaId, activo: true },
    },
    select: { sucursal_id: true },
  });
  return { empresaId: actor.empresaId, global: false, sucursalIds: assignments.map((a) => a.sucursal_id) };
}

export function canAccessBranch(access: BranchAccess, sucursalId: bigint): boolean {
  return access.global || access.sucursalIds.includes(sucursalId);
}

/** Para Prisma, una lista vacía implica denegación, nunca acceso global. */
export function allowedBranchWhere(access: BranchAccess): Prisma.sucursalWhereInput {
  return { empresa_id: access.empresaId, ...(access.global ? {} : { id: { in: access.sucursalIds } }) };
}
