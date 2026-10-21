import { prisma } from '../../../lib/prisma.js';
import type { QuoteTx } from '../types/quote.types.js';
import type { QuoteList } from '../quote.schema.js';

export const quoteInclude = {
  sucursal: { select: { id: true, codigo: true, nombre: true } },
  cliente: { select: { id: true, codigo: true, nombre: true } },
  cotizacion_detalle: {
    orderBy: { id: 'asc' as const },
    include: { producto: { select: { id: true, sku: true, nombre: true } } },
  },
} as const;

export const quoteRepository = {
  find(tx: QuoteTx, empresaId: bigint, id: bigint) {
    return tx.cotizacion.findFirst({ where: { id, empresa_id: empresaId }, include: quoteInclude });
  },
  async lock(tx: QuoteTx, empresaId: bigint, id: bigint) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM pos.cotizacion WHERE id = ${id} AND empresa_id = ${empresaId} FOR UPDATE
    `;
    return rows.length === 1;
  },
  async list(empresaId: bigint, branches: bigint[], query: QuoteList) {
    const where = {
      empresa_id: empresaId,
      sucursal_id: query.sucursal_id ? query.sucursal_id : { in: branches },
      ...(query.cliente_id !== undefined ? { cliente_id: query.cliente_id } : {}),
      ...(query.estado !== undefined ? { estado: query.estado } : {}),
      ...(query.q !== undefined ? { folio: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.cotizacion.findMany({ where, include: quoteInclude,
        orderBy: [{ fecha: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.cotizacion.count({ where }),
    ]);
    return { rows, total, page: query.page, pageSize: query.pageSize };
  },
};
