import { app } from "./app.js";
import { env } from "./config/env.js";
import { startInventorySyncWorker } from "./modules/inventory-sync/inventory-sync.worker.js";

app.listen(env.port, () => {
  console.log(
    `Servidor ejecutándose en http://localhost:${env.port}`,
  );

  startInventorySyncWorker();
});