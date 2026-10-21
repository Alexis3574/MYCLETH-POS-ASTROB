import type { PaymentMethodListInput } from "../payment-method.schema.js";

type PaymentMethodRecord = {
  id: bigint;
  codigo: string;
  nombre: string;
  es_efectivo: boolean;
  activo: boolean;
};

export function serializePaymentMethod(row: PaymentMethodRecord) {
  return {
    id: row.id.toString(),
    codigo: row.codigo,
    nombre: row.nombre,
    es_efectivo: row.es_efectivo,
    activo: row.activo,
  };
}

export function paymentMethodFilter(input: PaymentMethodListInput) {
  return {
    ...(input.activo === "all" ? {} : { activo: input.activo === "true" }),
    ...(input.codigo ? { codigo: input.codigo } : {}),
    ...(input.q ? {
      OR: [
        { codigo: { contains: input.q, mode: "insensitive" as const } },
        { nombre: { contains: input.q, mode: "insensitive" as const } },
      ],
    } : {}),
  };
}
