import { prisma } from "../../../lib/prisma.js";
import type { PaymentMethodListInput } from "../payment-method.schema.js";
import { paymentMethodFilter } from "../utils/payment-method.values.js";

const projection = {
  id: true,
  codigo: true,
  nombre: true,
  es_efectivo: true,
  activo: true,
} as const;

export const paymentMethodRepository = {
  async list(input: PaymentMethodListInput) {
    const where = paymentMethodFilter(input);
    const [total, rows] = await Promise.all([
      prisma.metodo_pago.count({ where }),
      prisma.metodo_pago.findMany({
        where,
        select: projection,
        orderBy: [{ codigo: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);
    return { total, rows };
  },
  get(id: bigint) {
    // El detalle incluye los inactivos para consultar operaciones históricas.
    return prisma.metodo_pago.findUnique({ where: { id }, select: projection });
  },
};
