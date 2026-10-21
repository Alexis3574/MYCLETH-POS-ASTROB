import { prisma } from '../../../lib/prisma.js';
import type { PurchaseTx } from '../types/purchase.types.js';

export const purchaseInclude = {
  proveedor: { select: { id: true, codigo: true, razon_social: true, activo: true } },
  sucursal: { select: { id: true, codigo: true, nombre: true } },
  almacen: { select: { id: true, codigo: true, nombre: true } },
  compra_detalle: {
    orderBy: { id: 'asc' as const },
    include: { producto: { select: { id: true, empresa_id: true, sku: true, codigo_barras: true,
      nombre: true, activo: true, tipo: true, controla_inventario: true,
      unidad_medida: { select: { permite_decimales: true, activo: true } } } } },
  },
  compra_pago: { orderBy: { id: 'asc' as const },
    include: { metodo_pago: { select: { codigo: true, nombre: true, es_efectivo: true } } } },
} as const;

export const purchaseRepository = {
  get(tx: PurchaseTx, empresaId: bigint, purchaseId: bigint) {
    return tx.compra.findFirst({ where: { id: purchaseId, empresa_id: empresaId }, include: purchaseInclude });
  },
  async lock(tx: PurchaseTx, empresaId: bigint, purchaseId: bigint): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM pos.compra WHERE id = ${purchaseId} AND empresa_id = ${empresaId} FOR UPDATE
    `;
    return rows.length === 1;
  },
  list(empresaId: bigint, where: { estado?: string; sucursal_id?: { in: bigint[] }; proveedor_id?: bigint }, page: number, pageSize: number) {
    const filter = { empresa_id: empresaId, ...where };
    return prisma.$transaction([
      prisma.compra.findMany({ where: filter, include: purchaseInclude, orderBy: [{ fecha: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      prisma.compra.count({ where: filter }),
    ]);
  },
};
