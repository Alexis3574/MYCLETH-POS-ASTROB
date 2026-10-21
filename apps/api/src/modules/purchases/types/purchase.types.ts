import type { Prisma } from '../../../generated/prisma/client.js';
import type { z } from 'zod';
import type { purchaseCreateSchema, purchasePaymentSchema } from '../purchase.schema.js';
export type PurchaseTx = Prisma.TransactionClient;
export interface PurchaseActor { empresaId: bigint; userId: bigint }
export type PurchaseCreateInput = z.infer<typeof purchaseCreateSchema>;
export type PurchasePaymentInput = z.infer<typeof purchasePaymentSchema>;
export type PurchaseAction = 'CREAR' | 'RECIBIR' | 'PAGAR' | 'CANCELAR';
