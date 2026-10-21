import type { PaymentMethodListInput } from "../payment-method.schema.js";
import { paymentMethodRepository } from "../repositories/payment-method.repository.js";
import { serializePaymentMethod } from "../utils/payment-method.values.js";

export const paymentMethodService = {
  async list(input: PaymentMethodListInput) {
    const { total, rows } = await paymentMethodRepository.list(input);
    return {
      items: rows.map(serializePaymentMethod),
      total,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: Math.ceil(total / input.pageSize),
    };
  },
  async get(id: bigint) {
    const result = await paymentMethodRepository.get(id);
    return result ? serializePaymentMethod(result) : null;
  },
};
