import type { OrderList } from '../order.schema.js';
import type { OrderTx } from '../types/order.types.js';

export const orderInclude = {
  sucursal: { select: { id: true, codigo: true, nombre: true } },
  cliente: { select: { id: true, codigo: true, nombre: true } },
  orden_venta_detalle: {
    orderBy: { id: 'asc' as const },
    include: { producto: { select: { id: true, sku: true, nombre: true } } },
  },
} as const;

export const orderRepository = {
  find(tx: OrderTx, empresaId: bigint, id: bigint) {
    return tx.orden_venta.findFirst({ where: { id, empresa_id: empresaId }, include: orderInclude });
  },
  async lock(tx: OrderTx, empresaId: bigint, id: bigint) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM pos.orden_venta WHERE id = ${id} AND empresa_id = ${empresaId} FOR UPDATE
    `;
    return rows.length === 1;
  },
  async list(tx: OrderTx, empresaId: bigint, branchIds: bigint[], query: OrderList) {
    const where = {
      empresa_id: empresaId,
      sucursal_id: query.sucursal_id ?? { in: branchIds },
      ...(query.cliente_id !== undefined ? { cliente_id: query.cliente_id } : {}),
      ...(query.estado !== undefined ? { estado: query.estado } : {}),
      ...(query.q !== undefined ? { folio: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      tx.orden_venta.findMany({ where, include: orderInclude,
        orderBy: [{ fecha: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      tx.orden_venta.count({ where }),
    ]);
    return { rows, total, page: query.page, pageSize: query.pageSize };
  },
};
