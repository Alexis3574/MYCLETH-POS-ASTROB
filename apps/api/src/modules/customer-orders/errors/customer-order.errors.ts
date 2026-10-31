import { Prisma } from '../../../generated/prisma/client.js';

export class CustomerOrderError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'CustomerOrderError';
  }
}

export const customerOrderErrors = {
  forbidden: () => new CustomerOrderError(403, 'CUSTOMER_ORDER_FORBIDDEN', 'Operación no autorizada.'),
  notFound: () => new CustomerOrderError(404, 'CUSTOMER_ORDER_NOT_FOUND', 'Pedido o recurso no encontrado.'),
  invalid: (message: string) => new CustomerOrderError(422, 'CUSTOMER_ORDER_INVALID', message),
  conflict: (message: string) => new CustomerOrderError(409, 'CUSTOMER_ORDER_CONFLICT', message),
};

export function translateCustomerOrderDatabaseError(error: unknown): Error {
  if (error instanceof CustomerOrderError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return customerOrderErrors.conflict('Folio o restricción única duplicada.');
    if (error.code === 'P2003') return customerOrderErrors.invalid('Referencia comercial inválida.');
    if (error.code === 'P2025') return customerOrderErrors.notFound();
    if (error.code === 'P2034') return customerOrderErrors.conflict('Conflicto concurrente; reintente.');
  }
  return error instanceof Error ? error : new Error('Error desconocido en pedidos.');
}
