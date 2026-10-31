import type { CustomerOrderList } from '../customer-order.schema.js';
import type { CustomerOrderTx } from '../types/customer-order.types.js';

export const customerOrderInclude = {
  sucursal: { select: { id: true, codigo: true, nombre: true } },
  cliente: { select: { id: true, codigo: true, nombre: true } },
  pedido_cliente_detalle: {
    orderBy: { id: 'asc' as const },
    include: { producto: { select: { id: true, sku: true, nombre: true } } },
  },
} as const;

export const customerOrderRepository = {
  find(tx: CustomerOrderTx, empresaId: bigint, id: bigint) {
    return tx.pedido_cliente.findFirst({ where: { id, empresa_id: empresaId }, include: customerOrderInclude });
  },
  async lock(tx: CustomerOrderTx, empresaId: bigint, id: bigint) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM pos.pedido_cliente WHERE id = ${id} AND empresa_id = ${empresaId} FOR UPDATE
    `;
    return rows.length === 1;
  },
  async list(tx: CustomerOrderTx, empresaId: bigint, branchIds: bigint[], query: CustomerOrderList) {
    const where = {
      empresa_id: empresaId,
      sucursal_id: query.sucursal_id ?? { in: branchIds },
      ...(query.cliente_id !== undefined ? { cliente_id: query.cliente_id } : {}),
      ...(query.estado !== undefined ? { estado: query.estado } : {}),
      ...(query.q !== undefined ? { folio: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };
    const rows = await tx.pedido_cliente.findMany({ where, include: customerOrderInclude,
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize,
      take: query.pageSize });
    const total = await tx.pedido_cliente.count({ where });
    return { rows, total, page: query.page, pageSize: query.pageSize };
  },
};
