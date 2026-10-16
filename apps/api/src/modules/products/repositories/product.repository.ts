import type { Prisma } from "../../../generated/prisma/client.js";
import type { ProductTransaction, ProductQuery } from "../types/product.types.js";

export const productInclude = {
  categoria: { select: { id: true, nombre: true, activo: true } },
  unidad_medida: { select: { id: true, codigo: true, nombre: true, permite_decimales: true, activo: true } },
  producto_impuesto: {
    orderBy: { impuesto_id: "asc" },
    include: { impuesto: { select: { id: true, codigo: true, nombre: true, tasa: true, activo: true } } },
  },
} satisfies Prisma.productoInclude;

export type ProductRecord = Prisma.productoGetPayload<{ include: typeof productInclude }>;

export const productRepository = {
  findById(tx: ProductTransaction, empresaId: bigint, id: bigint) {
    return tx.producto.findFirst({ where: { id, empresa_id: empresaId }, include: productInclude });
  },

  findByBarcode(tx: ProductTransaction, empresaId: bigint, barcode: string) {
    return tx.producto.findFirst({
      where: { empresa_id: empresaId, codigo_barras: barcode, activo: true },
      include: productInclude,
    });
  },

  async list(tx: ProductTransaction, empresaId: bigint, query: ProductQuery) {
    const where: Prisma.productoWhereInput = { empresa_id: empresaId };
    if (query.activo !== undefined) where.activo = query.activo;
    if (query.tipo !== undefined) where.tipo = query.tipo;
    if (query.sku !== undefined) where.sku = query.sku;
    if (query.barcode !== undefined) where.codigo_barras = query.barcode;
    if (query.categoria_id !== undefined) where.categoria_id = query.categoria_id;
    if (query.search !== undefined) {
      where.OR = [
        { nombre: { contains: query.search, mode: "insensitive" } },
        { sku: { contains: query.search, mode: "insensitive" } },
        { codigo_barras: { contains: query.search, mode: "insensitive" } },
      ];
    }
    const total = await tx.producto.count({ where });
    const rows = await tx.producto.findMany({
      where, include: productInclude,
      orderBy: [{ nombre: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit, take: query.limit,
    });
    return { total, rows };
  },

  async lock(tx: ProductTransaction, empresaId: bigint, id: bigint) {
    // La empresa forma parte también del bloqueo, no solo de la lectura.
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM producto WHERE id = ${id} AND empresa_id = ${empresaId} FOR UPDATE
    `;
    return rows.length > 0;
  },

  create(tx: ProductTransaction, data: Prisma.productoUncheckedCreateInput) {
    return tx.producto.create({ data, select: { id: true } });
  },

  update(tx: ProductTransaction, empresaId: bigint, id: bigint, data: Prisma.productoUncheckedUpdateManyInput) {
    return tx.producto.updateMany({ where: { id, empresa_id: empresaId }, data });
  },

  async replaceTaxes(tx: ProductTransaction, productoId: bigint, ids: bigint[]) {
    await tx.producto_impuesto.deleteMany({ where: { producto_id: productoId } });
    if (ids.length > 0) {
      await tx.producto_impuesto.createMany({ data: ids.map((impuesto_id) => ({ producto_id: productoId, impuesto_id })) });
    }
  },
};
