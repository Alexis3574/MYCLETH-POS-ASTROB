import type { ProductRecord } from "../repositories/product.repository.js";

export function serializeProduct(product: ProductRecord) {
  return {
    id: product.id.toString(), empresa_id: product.empresa_id.toString(),
    categoria_id: product.categoria_id?.toString() ?? null,
    unidad_medida_id: product.unidad_medida_id.toString(),
    sku: product.sku, codigo_barras: product.codigo_barras,
    nombre: product.nombre, descripcion: product.descripcion,
    tipo: product.tipo, controla_inventario: product.controla_inventario,
    costo_referencia: product.costo_referencia.toFixed(4),
    precio_venta: product.precio_venta.toFixed(2),
    stock_minimo: product.stock_minimo.toFixed(3),
    stock_maximo: product.stock_maximo?.toFixed(3) ?? null,
    activo: product.activo,
    creado_en: product.creado_en.toISOString(), actualizado_en: product.actualizado_en.toISOString(),
    categoria: product.categoria ? { ...product.categoria, id: product.categoria.id.toString() } : null,
    unidad_medida: { ...product.unidad_medida, id: product.unidad_medida.id.toString() },
    impuestos: product.producto_impuesto.map(({ impuesto }) => ({
      ...impuesto, id: impuesto.id.toString(), tasa: impuesto.tasa.toFixed(4),
    })),
  };
}

export function pagination(page: number, limit: number, total: number) {
  return { page, limit, total, total_pages: Math.ceil(total / limit) };
}
