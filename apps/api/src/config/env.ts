import "dotenv/config";

export const env = {
  port: Number(process.env.PORT) || 3000,
  corsOrigin:
    process.env.CORS_ORIGIN ||
    "http://localhost:5173",

  ecommerce: {
    baseUrl:
      process.env.ECOMMERCE_API_URL ||
      "http://127.0.0.1:8000/api/v1/pos",

    apiKey:
      process.env.ECOMMERCE_API_KEY || "",

    timeoutMs:
      Number(
        process.env.ECOMMERCE_API_TIMEOUT_MS,
      ) || 10000,
  },

  inventorySync: {
    enabled:
      process.env.INVENTORY_SYNC_ENABLED ===
      "true",

    intervalMs:
      Number(
        process.env.INVENTORY_SYNC_INTERVAL_MS,
      ) || 30000,

    batchSize:
      Number(
        process.env.INVENTORY_SYNC_BATCH_SIZE,
      ) || 20,

    processingTimeoutMs:
      Number(
        process.env
          .INVENTORY_SYNC_PROCESSING_TIMEOUT_MS,
      ) || 120000,
  },
};