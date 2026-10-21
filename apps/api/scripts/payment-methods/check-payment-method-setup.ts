import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const prisma = readFileSync("prisma/schema.prisma", "utf8");
const app = readFileSync("src/app.ts", "utf8");
assert.match(prisma, /model\s+metodo_pago\s*\{/);
assert.match(app, /import\s*\{\s*paymentMethodRouter\s*\}\s*from\s*["']\.\/modules\/payment-methods\/payment-method\.routes\.js["']/);
assert.match(app, /app\.use\(["']\/api\/v1\/payment-methods["'],\s*paymentMethodRouter\)/);
console.log("[OK] Integración de catálogo, modelo Prisma y ruta confirmados.");
