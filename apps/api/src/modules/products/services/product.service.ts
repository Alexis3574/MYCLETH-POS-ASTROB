import { prisma } from "../../../lib/prisma.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { productRepository } from "../repositories/product.repository.js";
import { catalogRepository } from "../repositories/catalog.repository.js";
import { ProductError, productNotFound } from "../errors/product.errors.js";
import { validateProductReferences, validateStockBounds } from "../validators/product.validator.js";
import { serializeProduct, pagination } from "../utils/product.serializer.js";
import type { CreateProductInput, UpdateProductInput, ProductQuery, CatalogQuery, CatalogKind, ProductTransaction } from "../types/product.types.js";

// Reintentos limitados solo para transacciones locales, sin llamadas externas.
async function write<T>(operation: (tx: ProductTransaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code !== "P2034") throw error;
      if (attempt === 2) throw new ProductError(409, "PRODUCT_CONCURRENT_CHANGE", "Cambio concurrente; vuelva a intentar la operación.");
    }
  }
  throw new Error("Transacción no completada.");
}

export const productService = {
  async list(empresaId: bigint, query: ProductQuery) {
    const result = await prisma.$transaction((tx) => productRepository.list(tx, empresaId, query), { isolationLevel: "RepeatableRead" });
    return { data: result.rows.map(serializeProduct), pagination: pagination(query.page, query.limit, result.total) };
  },
  async get(empresaId: bigint, id: bigint) {
    const row = await productRepository.findById(prisma, empresaId, id);
    if (!row) throw productNotFound();
    return serializeProduct(row);
  },
  async barcode(empresaId: bigint, barcode: string) {
    const row = await productRepository.findByBarcode(prisma, empresaId, barcode);
    if (!row) throw productNotFound();
    return serializeProduct(row);
  },
  async create(empresaId: bigint, input: CreateProductInput) {
    validateStockBounds(input.stock_minimo, input.stock_maximo);
    const inventory = input.controla_inventario ?? input.tipo === "PRODUCTO";
    if (input.tipo === "SERVICIO" && inventory) {
      throw new ProductError(400, "SERVICE_CANNOT_CONTROL_INVENTORY", "Un servicio no puede controlar inventario.", "controla_inventario");
    }
    return write(async (tx) => {
      await validateProductReferences(tx, empresaId, input);
      const { impuesto_ids, controla_inventario: _inventory, ...fields } = input;
      const created = await productRepository.create(tx, {
        ...fields, empresa_id: empresaId, controla_inventario: inventory, activo: true,
      });
      await productRepository.replaceTaxes(tx, created.id, impuesto_ids);
      const row = await productRepository.findById(tx, empresaId, created.id);
      if (!row) throw productNotFound();
      return serializeProduct(row);
    });
  },
  async update(empresaId: bigint, id: bigint, input: UpdateProductInput) {
    return write(async (tx) => {
      if (!await productRepository.lock(tx, empresaId, id)) throw productNotFound();
      const current = await productRepository.findById(tx, empresaId, id);
      if (!current) throw productNotFound();
      validateStockBounds(input.stock_minimo ?? current.stock_minimo.toFixed(3),
        input.stock_maximo === undefined ? current.stock_maximo?.toFixed(3) ?? null : input.stock_maximo);
      await validateProductReferences(tx, empresaId, input);
      const data: Prisma.productoUncheckedUpdateManyInput = { actualizado_en: new Date() };
      // Asignación explícita: no permitir empresa_id, activo ni IDs operativos.
      if (input.nombre !== undefined) data.nombre = input.nombre;
      if (input.descripcion !== undefined) data.descripcion = input.descripcion;
      if (input.categoria_id !== undefined) data.categoria_id = input.categoria_id;
      if (input.precio_venta !== undefined) data.precio_venta = input.precio_venta;
      if (input.costo_referencia !== undefined) data.costo_referencia = input.costo_referencia;
      if (input.stock_minimo !== undefined) data.stock_minimo = input.stock_minimo;
      if (input.stock_maximo !== undefined) data.stock_maximo = input.stock_maximo;
      await productRepository.update(tx, empresaId, id, data);
      if (input.impuesto_ids !== undefined) await productRepository.replaceTaxes(tx, id, input.impuesto_ids);
      const row = await productRepository.findById(tx, empresaId, id);
      if (!row) throw productNotFound();
      return serializeProduct(row);
    });
  },
  async status(empresaId: bigint, id: bigint, activo: boolean) {
    return write(async (tx) => {
      if (!await productRepository.lock(tx, empresaId, id)) throw productNotFound();
      const current = await productRepository.findById(tx, empresaId, id);
      if (!current) throw productNotFound();
      if (activo) {
        await validateProductReferences(tx, empresaId, {
          categoria_id: current.categoria_id, unidad_medida_id: current.unidad_medida_id,
          impuesto_ids: current.producto_impuesto.map((row) => row.impuesto_id),
        });
      }
      if (current.activo !== activo) {
        await productRepository.update(tx, empresaId, id, { activo, actualizado_en: new Date() });
      }
      const row = await productRepository.findById(tx, empresaId, id);
      if (!row) throw productNotFound();
      return serializeProduct(row);
    });
  },
  async catalog(empresaId: bigint, kind: CatalogKind, query: CatalogQuery) {
    return prisma.$transaction(async (tx) => {
      if (kind === "categories") {
        const result = await catalogRepository.categories(tx, empresaId, query);
        return { data: result.rows.map((r) => ({ ...r, id: r.id.toString(), categoria_padre_id: r.categoria_padre_id?.toString() ?? null })),
          pagination: pagination(query.page, query.limit, result.total) };
      }
      if (kind === "units") {
        const result = await catalogRepository.units(tx, query);
        return { data: result.rows.map((r) => ({ ...r, id: r.id.toString() })),
          pagination: pagination(query.page, query.limit, result.total) };
      }
      const result = await catalogRepository.taxes(tx, empresaId, query);
      return { data: result.rows.map((r) => ({ ...r, id: r.id.toString(), tasa: r.tasa.toFixed(4) })),
        pagination: pagination(query.page, query.limit, result.total) };
    }, { isolationLevel: "RepeatableRead" });
  },
};
