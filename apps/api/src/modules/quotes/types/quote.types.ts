import type { Prisma } from '../../../generated/prisma/client.js';
import type { prisma } from '../../../lib/prisma.js';
export type QuoteActor = { empresaId: bigint; userId: bigint };
export type QuoteTx = Prisma.TransactionClient;
export type QuoteClient = typeof prisma;
export type QuoteAction = 'send' | 'accept' | 'reject' | 'cancel' | 'expire';
