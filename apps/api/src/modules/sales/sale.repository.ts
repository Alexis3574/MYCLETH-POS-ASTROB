import {
  saleContextRepository,
} from "./repositories/sale-context.repository.js";

import {
  saleInventoryRepository,
} from "./repositories/sale-inventory.repository.js";

import {
  salePaymentRepository,
} from "./repositories/sale-payment.repository.js";

import {
  saleWriteRepository,
} from "./repositories/sale.repository.js";

export type {
  SaleTransaction,
} from "./types/sales.types.js";

export {
  saleContextRepository,
  saleInventoryRepository,
  salePaymentRepository,
  saleWriteRepository,
};

export const saleRepository = {
  ...saleWriteRepository,
  ...saleContextRepository,
  ...saleInventoryRepository,
  ...salePaymentRepository,
};