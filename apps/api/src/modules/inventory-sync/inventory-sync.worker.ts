import { env } from "../../config/env.js";
import { inventorySyncService } from "./inventory-sync.service.js";

let running = false;

let timer:
  | NodeJS.Timeout
  | null = null;

async function runCycle() {
  if (running) {
    return;
  }

  running = true;

  try {
    const result =
      await inventorySyncService.processPending();

    if (result.processed > 0) {
      console.log(
        `[inventory-sync] Procesadas ${result.processed} operación(es).`,
      );
    }
  } catch (error) {
    console.error(
      "[inventory-sync] Error procesando la outbox:",
      error,
    );
  } finally {
    running = false;
  }
}

export function startInventorySyncWorker() {
  if (!env.inventorySync.enabled) {
    console.log(
      "[inventory-sync] Worker deshabilitado.",
    );

    return;
  }

  if (timer) {
    return;
  }

  console.log(
    `[inventory-sync] Worker iniciado cada ${env.inventorySync.intervalMs} ms.`,
  );

  void runCycle();

  timer = setInterval(
    () => {
      void runCycle();
    },
    env.inventorySync.intervalMs,
  );
}

export function stopInventorySyncWorker() {
  if (!timer) {
    return;
  }

  clearInterval(timer);
  timer = null;
}