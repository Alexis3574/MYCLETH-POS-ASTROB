import type { Prisma } from '../../../generated/prisma/client.js';

export type OrderTx = Prisma.TransactionClient;
export type OrderActor = { empresaId: bigint; userId: bigint };
export type OrderAction = 'start' | 'ready' | 'cancel';
