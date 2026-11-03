import { Prisma } from '../../../generated/prisma/client.js';

export class OrderError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'OrderError';
  }
}

export const orderErrors = {
  forbidden: () => new OrderError(403, 'ORDER_FORBIDDEN', 'Operación no autorizada.'),
  notFound: () => new OrderError(404, 'ORDER_NOT_FOUND', 'Orden o recurso no encontrado.'),
  invalid: (message: string) => new OrderError(422, 'ORDER_INVALID', message),
  conflict: (message: string) => new OrderError(409, 'ORDER_CONFLICT', message),
};

export function translateOrderDatabaseError(error: unknown): Error {
  if (error instanceof OrderError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return orderErrors.conflict('El folio o la relación de origen ya existe.');
    if (error.code === 'P2003') return orderErrors.invalid('Existe una referencia comercial inválida.');
    if (error.code === 'P2025') return orderErrors.notFound();
    if (error.code === 'P2034') return orderErrors.conflict('Conflicto concurrente; reintente la operación.');
  }
  return error instanceof Error ? error : new Error('Error desconocido en órdenes.');
}
