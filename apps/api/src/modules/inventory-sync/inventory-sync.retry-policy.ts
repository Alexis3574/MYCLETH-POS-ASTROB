export interface InventorySyncRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: InventorySyncRetryPolicy = {
  maxAttempts: 10,
  baseDelayMs: 30000,
  maxDelayMs: 900000
};

function positiveInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = process.env[name];

  if (raw === undefined || raw === "") return fallback;

  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} requiere un entero positivo.`);
  }

  const value = Number(raw);

  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${name} está fuera de rango.`);
  }

  return value;
}

export function getRetryPolicy(): InventorySyncRetryPolicy {
  const maxAttempts = positiveInteger(
    "INVENTORY_SYNC_MAX_ATTEMPTS", 10, 1, 100
  );

  const baseDelayMs = positiveInteger(
    "INVENTORY_SYNC_RETRY_BASE_DELAY_MS",
    30000, 1000, 900000
  );

  const maxDelayMs = positiveInteger(
    "INVENTORY_SYNC_RETRY_MAX_DELAY_MS",
    900000, baseDelayMs, 86400000
  );

  return { maxAttempts, baseDelayMs, maxDelayMs };
}

export function retryDelayMs(
  attempts: number,
  policy: InventorySyncRetryPolicy
): number {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    return 0;
  }

  const exponent = Math.min(attempts - 1, 20);

  return Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** exponent
  );
}

export function retryExhausted(
  attempts: number,
  policy: InventorySyncRetryPolicy
): boolean {
  return attempts >= policy.maxAttempts;
}

export function retryDue(
  attempts: number,
  lastAttempt: Date | null,
  now: Date,
  policy: InventorySyncRetryPolicy
): boolean {
  if (retryExhausted(attempts, policy)) return false;
  if (attempts === 0 || lastAttempt === null) return true;

  return now.getTime() - lastAttempt.getTime() >=
    retryDelayMs(attempts, policy);
}
