import type { OrganizationTransaction as Tx, OrganizationActor } from "../types/organization.types.js";
import { organizationError } from "../errors/organization.errors.js";

export async function requireCompany(tx: Tx, actor: OrganizationActor, lock = false) {
  if (lock) await tx.$queryRaw`SELECT id FROM "pos"."empresa" WHERE id = ${actor.empresaId} FOR UPDATE`;
  const company = await tx.empresa.findUnique({ where: { id: actor.empresaId } });
  if (!company?.activo) throw organizationError.forbidden();
  return company;
}
export async function requireBranch(tx: Tx, actor: OrganizationActor, id: bigint, lock = false) {
  if (lock) {
    await tx.$queryRaw`SELECT id FROM "pos"."sucursal" WHERE id = ${id} AND empresa_id = ${actor.empresaId} FOR UPDATE`;
  }
  const branch = await tx.sucursal.findFirst({ where: { id, empresa_id: actor.empresaId } });
  if (!branch) throw organizationError.notFound("Sucursal");
  return branch;
}
export async function requireWarehouse(tx: Tx, actor: OrganizationActor, id: bigint, lock = false) {
  if (lock) {
    await tx.$queryRaw`SELECT a.id FROM "pos"."almacen" a
       INNER JOIN "pos"."sucursal" s ON s.id = a.sucursal_id
       WHERE a.id = ${id} AND s.empresa_id = ${actor.empresaId} FOR UPDATE OF a`;
  }
  const warehouse = await tx.almacen.findFirst({
    where: { id, sucursal: { empresa_id: actor.empresaId } },
    include: { sucursal: { select: { id: true, empresa_id: true, activo: true, codigo: true } } },
  });
  if (!warehouse) throw organizationError.notFound("Almacén");
  return warehouse;
}
export async function audit(tx: Tx, actor: OrganizationActor, table: string, id: bigint, action: "INSERT" | "UPDATE" | "DELETE", changes: Record<string, string | boolean | number | null>) {
  await tx.auditoria.create({ data: {
    usuario_id: actor.userId, tabla: table, registro_id: id, accion: action, datos_nuevos: changes,
  } });
}
export async function ensureFreeWarehouse(tx: Tx, id: bigint): Promise<void> {
  // Secuencial: una única conexión PostgreSQL no debe recibir queries solapadas.
  const stock = await tx.existencia.count({ where: {
    almacen_id: id, OR: [{ cantidad: { gt: 0 } }, { reservado: { gt: 0 } }],
  } });
  const draftTransfer = await tx.transferencia_almacen.count({ where: {
    estado: "BORRADOR", OR: [{ almacen_origen_id: id }, { almacen_destino_id: id }],
  } });
  const draftPurchase = await tx.compra.count({ where: { almacen_id: id, estado: "BORRADOR" } });
  const draftSale = await tx.venta.count({ where: { almacen_id: id, estado: "BORRADOR" } });
  if (stock || draftTransfer || draftPurchase || draftSale) {
    throw organizationError.conflict("Almacén con stock, reservas o documentos abiertos. Debe regularizarlo antes de desactivar.");
  }
}
export async function ensureFreeBranch(tx: Tx, id: bigint): Promise<void> {
  const warehouses = await tx.almacen.count({ where: { sucursal_id: id, activo: true } });
  const cashRegisters = await tx.caja.count({ where: { sucursal_id: id, activo: true } });
  const users = await tx.usuario_sucursal.count({ where: { sucursal_id: id } });
  const pendingPurchase = await tx.compra.count({ where: { sucursal_id: id, estado: "BORRADOR" } });
  const draftSale = await tx.venta.count({ where: { sucursal_id: id, estado: "BORRADOR" } });
  const pendingOrders = await tx.orden_venta.count({ where: { sucursal_id: id, estado: "PENDIENTE" } });
  const pendingCustomerOrders = await tx.pedido_cliente.count({ where: { sucursal_id: id, estado: "PENDIENTE" } });
  if (warehouses || cashRegisters || users || pendingPurchase || draftSale || pendingOrders || pendingCustomerOrders) {
    throw organizationError.conflict("Sucursal con almacenes o cajas activos, usuarios asignados o documentos pendientes.");
  }
  const activeSessions = await tx.sesion_caja.count({ where: { caja: { sucursal_id: id }, estado: "ABIERTA" } });
  if (activeSessions) throw organizationError.conflict("Sucursal con sesiones de caja abiertas.");
}
