import { catalogRepository } from "../repositories/catalog.repository.js";
import { ProductError } from "../errors/product.errors.js";
import type { ProductTransaction } from "../types/product.types.js";
import { stockBoundsValid } from "../utils/product-values.js";

export function validateStockBounds(minimum: string, maximum: string | null) {
  if (!stockBoundsValid(minimum, maximum)) {
    throw new ProductError(400, "INVALID_STOCK_RANGE", "stock_maximo no puede ser menor que stock_minimo.", "stock_maximo");
  }
}

export async function validateProductReferences(
  tx: ProductTransaction,
  empresaId: bigint,
  refs: { categoria_id?: bigint | null | undefined; unidad_medida_id?: bigint | undefined; impuesto_ids?: bigint[] | undefined },
) {
  if (refs.categoria_id !== undefined && refs.categoria_id !== null) {
    if (!await catalogRepository.findCategory(tx, empresaId, refs.categoria_id)) {
      throw new ProductError(400, "INVALID_PRODUCT_CATEGORY", "Categoría inexistente, inactiva o ajena a la empresa.", "categoria_id");
    }
  }
  if (refs.unidad_medida_id !== undefined && !await catalogRepository.findUnit(tx, refs.unidad_medida_id)) {
    throw new ProductError(400, "INVALID_PRODUCT_UNIT", "Unidad inexistente o inactiva.", "unidad_medida_id");
  }
  if (refs.impuesto_ids !== undefined && refs.impuesto_ids.length > 0) {
    const taxes = await catalogRepository.findTaxes(tx, empresaId, refs.impuesto_ids);
    if (taxes.length !== refs.impuesto_ids.length) {
      throw new ProductError(400, "INVALID_PRODUCT_TAXES", "Hay impuestos inexistentes, inactivos o ajenos a la empresa.", "impuesto_ids");
    }
  }
}
