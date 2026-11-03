import type { Prisma } from '../../../generated/prisma/client.js';
import type { CustomerOrderAction } from '../utils/customer-order-values.js';

export type CustomerOrderTx = Prisma.TransactionClient;
export type CustomerOrderActor = { empresaId: bigint; userId: bigint };
export type { CustomerOrderAction };
