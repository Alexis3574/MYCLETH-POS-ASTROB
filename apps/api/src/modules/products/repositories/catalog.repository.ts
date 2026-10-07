import type { CatalogQuery, ProductTransaction } from "../types/product.types.js";

export const catalogRepository = {
  findCategory(tx: ProductTransaction, empresaId: bigint, id: bigint) {
    return tx.categoria.findFirst({ where: { id, empresa_id: empresaId, activo: true }, select: { id: true } });
  },
  findUnit(tx: ProductTransaction, id: bigint) {
    return tx.unidad_medida.findFirst({ where: { id, activo: true }, select: { id: true } });
  },
  findTaxes(tx: ProductTransaction, empresaId: bigint, ids: bigint[]) {
    return tx.impuesto.findMany({
      where: { id: { in: ids }, empresa_id: empresaId, activo: true }, select: { id: true },
    });
  },
  async categories(tx: ProductTransaction, empresaId: bigint, query: CatalogQuery) {
    const where = {
      empresa_id: empresaId,
      ...(query.activo === undefined ? {} : { activo: query.activo }),
      ...(query.search === undefined ? {} : { nombre: { contains: query.search, mode: "insensitive" as const } }),
    };
    const total = await tx.categoria.count({ where });
    const rows = await tx.categoria.findMany({
      where, select: { id: true, categoria_padre_id: true, nombre: true, descripcion: true, activo: true },
      orderBy: [{ nombre: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit,
    });
    return { total, rows };
  },
  async units(tx: ProductTransaction, query: CatalogQuery) {
    const where = {
      ...(query.activo === undefined ? {} : { activo: query.activo }),
      ...(query.search === undefined ? {} : { OR: [
        { nombre: { contains: query.search, mode: "insensitive" as const } },
        { codigo: { contains: query.search, mode: "insensitive" as const } },
      ] }),
    };
    const total = await tx.unidad_medida.count({ where });
    const rows = await tx.unidad_medida.findMany({
      where, select: { id: true, codigo: true, nombre: true, permite_decimales: true, activo: true },
      orderBy: [{ nombre: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit,
    });
    return { total, rows };
  },
  async taxes(tx: ProductTransaction, empresaId: bigint, query: CatalogQuery) {
    const where = {
      empresa_id: empresaId,
      ...(query.activo === undefined ? {} : { activo: query.activo }),
      ...(query.search === undefined ? {} : { OR: [
        { nombre: { contains: query.search, mode: "insensitive" as const } },
        { codigo: { contains: query.search, mode: "insensitive" as const } },
      ] }),
    };
    const total = await tx.impuesto.count({ where });
    const rows = await tx.impuesto.findMany({
      where, select: { id: true, codigo: true, nombre: true, tasa: true, activo: true },
      orderBy: [{ nombre: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit,
    });
    return { total, rows };
  },
};
