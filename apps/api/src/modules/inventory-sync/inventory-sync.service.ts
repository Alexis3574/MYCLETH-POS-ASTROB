import { env } from "../../config/env.js";

import {
  EcommerceApiError,
} from "../../integrations/ecommerce/ecommerce.client.js";

import {
  adjustEcommerceInventory,
} from "../../integrations/ecommerce/inventory.client.js";

import {
  findEcommerceProductByBarcode,
} from "../../integrations/ecommerce/product.client.js";

import {
  inventorySyncRepository,
} from "./inventory-sync.repository.js";

import { getRetryPolicy, retryExhausted } from "./inventory-sync.retry-policy.js";

function formatError(error: unknown): string {
  if (error instanceof EcommerceApiError) {
    let response = "";

    try {
      response = JSON.stringify(
        error.responseBody,
      );
    } catch {
      response = String(
        error.responseBody,
      );
    }

    return `${error.message}: ${response}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export const inventorySyncService = {
  async processOne(id: bigint) {
    const current =
      await inventorySyncRepository.findById(id);

    if (!current) {
      return {
        status: "NOT_FOUND" as const,
      };
    }

    if (
      current.estado ===
      "SINCRONIZADO"
    ) {
      return {
        status:
          "ALREADY_SYNCHRONIZED" as const,
      };
    }

    if (current.estado === "AGOTADO") {
      return { status: "EXHAUSTED" as const };
    }

    const policy = getRetryPolicy();

    if (
      current.estado === "PENDIENTE" &&
      retryExhausted(current.intentos, policy)
    ) {
      return { status: "EXHAUSTED" as const };
    }

    const claim =
      await inventorySyncRepository.tryClaim(
        id,
      );

    if (claim.count !== 1) {
      const refreshed =
        await inventorySyncRepository.findById(
          id,
        );

      if (!refreshed) {
        return {
          status: "NOT_FOUND" as const,
        };
      }

      if (
        refreshed.estado ===
        "SINCRONIZADO"
      ) {
        return {
          status:
            "ALREADY_SYNCHRONIZED" as const,
        };
      }

      if (
        refreshed.estado === "AGOTADO" ||
        (
          refreshed.estado === "PENDIENTE" &&
          retryExhausted(refreshed.intentos, policy)
        )
      ) {
        return { status: "EXHAUSTED" as const };
      }

      return {
        status: "BUSY" as const,
      };
    }

    const sync =
      await inventorySyncRepository.findById(
        id,
      );

    if (!sync) {
      return {
        status: "NOT_FOUND" as const,
      };
    }

    if (
      sync.estado !== (
        claim.mode === "MANUAL"
          ? "PROCESANDO_MANUAL" : "PROCESANDO"
      ) ||
      sync.intentos !== claim.attempts
    ) {
      return { status: "STALE_CLAIM" as const };
    }

    try {
      let ecommerceProductId =
        sync.ecommerce_product_id;

      if (
        ecommerceProductId === null
      ) {
        if (!sync.codigo_barras) {
          throw new Error(
            `Cannot resolve e-commerce product for SKU ${sync.sku}: local product has no barcode`,
          );
        }

        const ecommerceProduct =
          await findEcommerceProductByBarcode(
            sync.codigo_barras,
          );

        if (!ecommerceProduct) {
          throw new Error(
            `Product with barcode ${sync.codigo_barras} was not found in the e-commerce`,
          );
        }

        ecommerceProductId = BigInt(
          ecommerceProduct.productId,
        );
      }

      const result =
        await adjustEcommerceInventory({
          productId: Number(
            ecommerceProductId,
          ),

          operationId:
            sync.operation_id,

          adjustment:
            sync.adjustment,
        });

      const finalized = await inventorySyncRepository.markSynchronized(
        sync.id, ecommerceProductId, claim.attempts, claim.mode
      );

      if (finalized.count !== 1) {
        return { status: "STALE_CLAIM" as const };
      }

      return {
        status:
          "SYNCHRONIZED" as const,

        idempotentReplay:
          result.idempotentReplay,

        ecommerceProductId:
          ecommerceProductId.toString(),

        inventory:
          result.body.data.inventory,
      };
    } catch (error) {
      const message =
        formatError(error);

      const finalized = await inventorySyncRepository.markFailed(
        sync.id, message, claim.attempts, claim.mode
      );

      if (finalized.count !== 1) {
        return { status: "STALE_CLAIM" as const };
      }

      return {
        status: claim.mode === "MANUAL" ||
          retryExhausted(claim.attempts, policy)
          ? "EXHAUSTED" as const
          : "PENDING_RETRY" as const,

        error:
          message,
      };
    }
  },

  async processPending(
    limit =
      env.inventorySync.batchSize,
  ) {
    const staleBefore =
      new Date(
        Date.now() -
          env.inventorySync
            .processingTimeoutMs,
      );

    await inventorySyncRepository.requeueStaleProcessing(
      staleBefore,
    );

    await inventorySyncRepository.markExhaustedPending();

    const pending =
      await inventorySyncRepository.findPending(
        limit,
      );

    const results = [];

    for (const sync of pending) {
      const result =
        await this.processOne(
          sync.id,
        );

      results.push({
        id:
          sync.id.toString(),

        operationId:
          sync.operation_id,

        result,
      });
    }

    return {
      processed:
        results.length,

      results,
    };
  },
};