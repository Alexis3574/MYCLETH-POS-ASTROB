import type { Prisma } from "../../../generated/prisma/client.js";
import type { CreateTransferInput, TransferActor, TransferQuery, TransferTransaction } from "../types/transfer.types.js";
import { orderedDetails } from "../utils/transfer-values.js";

const warehouseSelect = { id: true, codigo: true, nombre: true, activo: true,
  sucursal: { select: { id: true, codigo: true, nombre: true, activo: true, empresa_id: true } } } satisfies Prisma.almacenSelect;
const summarySelect = {
  id: true, empresa_id: true, almacen_origen_id: true, almacen_destino_id: true, usuario_id: true,
  folio: true, fecha: true, estado: true, observaciones: true, creado_en: true, actualizado_en: true,
  almacen_transferencia_almacen_almacen_origen_idToalmacen: { select: warehouseSelect },
  almacen_transferencia_almacen_almacen_destino_idToalmacen: { select: warehouseSelect },
  _count: { select: { transferencia_detalle: true } },
} satisfies Prisma.transferencia_almacenSelect;
const detailSelect = { ...summarySelect, transferencia_detalle: { orderBy: { producto_id: "asc" },
  select: { id: true, producto_id: true, cantidad: true,
    producto: { select: { id: true, sku: true, codigo_barras: true, nombre: true, activo: true,
      unidad_medida: { select: { id: true, codigo: true, nombre: true, permite_decimales: true } } } } } } } satisfies Prisma.transferencia_almacenSelect;

export type TransferSummaryRecord = Prisma.transferencia_almacenGetPayload<{ select: typeof summarySelect }>;
export type TransferRecord = Prisma.transferencia_almacenGetPayload<{ select: typeof detailSelect }>;

export function transferScope(empresaId: bigint): Prisma.transferencia_almacenWhereInput {
  return { empresa_id: empresaId, usuario: { empresa_id: empresaId },
    almacen_transferencia_almacen_almacen_origen_idToalmacen: { sucursal: { empresa_id: empresaId } },
    almacen_transferencia_almacen_almacen_destino_idToalmacen: { sucursal: { empresa_id: empresaId } },
    transferencia_detalle: { every: { producto: { empresa_id: empresaId } } } };
}

export const transferRepository = {
  async list(tx: TransferTransaction, empresaId: bigint, query: TransferQuery) {
    const where: Prisma.transferencia_almacenWhereInput = { ...transferScope(empresaId) };
    const and: Prisma.transferencia_almacenWhereInput[] = [];
    if (query.estado !== undefined) where.estado = query.estado;
    if (query.almacen_origen_id !== undefined) where.almacen_origen_id = query.almacen_origen_id;
    if (query.almacen_destino_id !== undefined) where.almacen_destino_id = query.almacen_destino_id;
    if (query.almacen_id !== undefined) and.push({ OR: [{ almacen_origen_id: query.almacen_id }, { almacen_destino_id: query.almacen_id }] });
    if (query.producto_id !== undefined) and.push({ transferencia_detalle: { some: { producto_id: query.producto_id } } });
    if (query.search !== undefined) and.push({ OR: [{ folio: { contains: query.search, mode: "insensitive" } }, { observaciones: { contains: query.search, mode: "insensitive" } }] });
    if (query.fecha_desde || query.fecha_hasta) where.fecha = { gte: query.fecha_desde, lte: query.fecha_hasta };
    if (and.length) where.AND = and;
    const total = await tx.transferencia_almacen.count({ where });
    const rows = await tx.transferencia_almacen.findMany({ where, select: summarySelect,
      orderBy: [{ fecha: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit });
    return { total, rows };
  },
  find(tx: TransferTransaction, empresaId: bigint, id: bigint) {
    return tx.transferencia_almacen.findFirst({ where: { ...transferScope(empresaId), id }, select: detailSelect });
  },
  async lock(tx: TransferTransaction, empresaId: bigint, id: bigint) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM pos.transferencia_almacen WHERE id = ${id} AND empresa_id = ${empresaId} FOR UPDATE
    `;
    return rows.length === 1;
  },
  create(tx: TransferTransaction, actor: TransferActor, input: CreateTransferInput, key: string) {
    return tx.transferencia_almacen.create({ data: {
      empresa_id: actor.empresaId, usuario_id: actor.userId,
      almacen_origen_id: input.almacen_origen_id, almacen_destino_id: input.almacen_destino_id,
      folio: input.folio ?? `TR-${key}`, estado: "BORRADOR", observaciones: input.observaciones,
      transferencia_detalle: { create: orderedDetails(input.detalles).map((item) => ({ producto_id: item.producto_id, cantidad: item.cantidad })) },
    }, select: { id: true } });
  },
  async cancel(tx: TransferTransaction, empresaId: bigint, id: bigint) {
    return tx.transferencia_almacen.updateMany({ where: { ...transferScope(empresaId), id, estado: "BORRADOR" }, data: { estado: "CANCELADA", actualizado_en: new Date() } });
  },
};
