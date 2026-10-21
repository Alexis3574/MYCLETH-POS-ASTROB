import { createHash } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client.js';

export function normalizePositiveDecimal(value: string | number, scale: number, positive = false): string | null {
  const raw = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;
  const integer = match[1]!.replace(/^0+(?=\d)/, '');
  const fractional = match[2] ?? '';
  if (integer.length > 14 - scale || fractional.length > scale) return null;
  const normalized = `${integer}.${fractional.padEnd(scale, '0')}`;
  if (positive && new Prisma.Decimal(normalized).lte(0)) return null;
  return normalized;
}

export function hashPurchaseRequest(userId: bigint, action: string, purchaseId: bigint | null, content: unknown): string {
  return createHash('sha256').update(JSON.stringify({ user_id: userId.toString(), action, purchase_id: purchaseId?.toString() ?? null, content })).digest('hex');
}

export function safePurchaseJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, current: unknown) =>
    typeof current === 'bigint' ? current.toString() : current));
}

export function parsePositiveId(value: unknown): bigint | null {
  const string = String(value);
  if (!/^\d{1,19}$/.test(string)) return null;
  const id = BigInt(string);
  return id > 0n && id <= 9223372036854775807n ? id : null;
}

export function purchaseOperationId(empresaId: bigint, purchaseId: bigint, detailId: bigint, action: 'stock-in' | 'stock-out'): string {
  return `purchase:company:${empresaId}:id:${purchaseId}:detail:${detailId}:${action}`;
}
