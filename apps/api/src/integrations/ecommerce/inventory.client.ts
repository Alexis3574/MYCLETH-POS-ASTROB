import { ecommerceRequestWithMeta } from "./ecommerce.client.js";

interface InventoryAdjustmentResponse {
  success: boolean;
  message: string;
  data: {
    operation_id: string;
    product_id: number;
    sku?: string | null;
    barcode?: string | null;
    is_variation?: boolean;
    previous_quantity: number;
    adjustment: number;
    inventory: {
      managed?: boolean;
      quantity: number;
      stock_status?: string | null;
      is_out_of_stock?: boolean;
      allow_checkout_when_out_of_stock?: boolean;
    };
    updated_at?: string | null;
  };
}

interface AdjustInventoryParams {
  productId: number;
  operationId: string;
  adjustment: number;
}

export async function adjustEcommerceInventory({
  productId,
  operationId,
  adjustment,
}: AdjustInventoryParams) {
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new Error("productId must be a positive integer");
  }

  if (!operationId.trim()) {
    throw new Error("operationId is required");
  }

  if (!Number.isInteger(adjustment) || adjustment === 0) {
    throw new Error(
      "adjustment must be a non-zero integer",
    );
  }

  const response =
    await ecommerceRequestWithMeta<InventoryAdjustmentResponse>(
      `/products/${productId}/inventory`,
      {
        method: "PATCH",
        body: {
          operation_id: operationId,
          adjustment,
        },
      },
    );

  return {
    status: response.status,
    idempotentReplay:
      response.headers.get("x-idempotent-replay") ===
      "true",
    body: response.data,
  };
}