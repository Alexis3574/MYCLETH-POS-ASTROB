import { ecommerceRequest } from "./ecommerce.client.js";

interface EcommercePricing {
  base_price: number;
  sale_price: number | null;
  effective_price: number;
  original_price: number;
  currency_code: string | null;
}

interface EcommerceInventory {
  managed: boolean;
  quantity: number;
  stock_status: string | null;
  is_out_of_stock: boolean;
  allow_checkout_when_out_of_stock: boolean;
}

export interface EcommerceVariation {
  variation_id: number;
  product_id: number;
  is_default: boolean;
  name: string;
  sku: string | null;
  barcode: string | null;
  attributes: Record<string, string>;
  pricing: EcommercePricing;
  inventory: EcommerceInventory;
  updated_at: string | null;
}

export interface EcommerceProduct {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  has_variations: boolean;
  sellable_directly: boolean;
  pricing: EcommercePricing;
  inventory: EcommerceInventory;
  variations: EcommerceVariation[];
  updated_at: string | null;
}

interface EcommerceProductsResponse {
  success: boolean;
  data: EcommerceProduct[];
  meta: {
    current_page: number;
    per_page: number;
    total: number;
    last_page: number;
  };
}

export interface ResolvedEcommerceProduct {
  productId: number;
  sku: string | null;
  barcode: string | null;
  isVariation: boolean;
}

export async function findEcommerceProductByBarcode(
  barcode: string,
): Promise<ResolvedEcommerceProduct | null> {
  const normalizedBarcode = barcode.trim();

  if (!normalizedBarcode) {
    throw new Error("barcode is required");
  }

  const response =
    await ecommerceRequest<EcommerceProductsResponse>(
      `/products?barcode=${encodeURIComponent(normalizedBarcode)}`,
    );

  if (!response.success || response.data.length === 0) {
    return null;
  }

  for (const product of response.data) {
    const variation = product.variations.find(
      (item) => item.barcode === normalizedBarcode,
    );

    if (variation) {
      return {
        productId: variation.product_id,
        sku: variation.sku,
        barcode: variation.barcode,
        isVariation: true,
      };
    }

    if (
      product.barcode === normalizedBarcode &&
      product.sellable_directly
    ) {
      return {
        productId: product.id,
        sku: product.sku,
        barcode: product.barcode,
        isVariation: false,
      };
    }
  }

  return null;
}