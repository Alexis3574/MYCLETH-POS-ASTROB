import {
  saleCancelService,
} from "./services/sale-cancel.service.js";

import {
  saleCreateService,
} from "./services/sale-create.service.js";

export {
  InsufficientStockError,
  SaleCancellationConflictError,
  SaleCashSessionConflictError,
  SaleContextError,
  SaleCreditRequiresClientError,
  SaleHasReturnsError,
  SaleNotFoundError,
  SalePaymentMethodError,
  SalePaymentTotalMismatchError,
} from "./errors/sale.errors.js";

export const saleService = {
  createSale:
    saleCreateService.createSale,

  cancelSale:
    saleCancelService.cancelSale,
};
