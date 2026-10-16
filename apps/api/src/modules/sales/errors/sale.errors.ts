export class SaleContextError extends Error {
  readonly code =
    "INVALID_SALE_CONTEXT";

  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);

    this.name =
      "SaleContextError";
  }
}

export class SalePaymentMethodError extends Error {
  readonly code =
    "INVALID_PAYMENT_METHOD";

  constructor(
    public readonly paymentMethodId: bigint,
  ) {
    super(
      "El método de pago indicado no existe o se encuentra inactivo.",
    );

    this.name =
      "SalePaymentMethodError";
  }
}

export class SalePaymentTotalMismatchError extends Error {
  readonly code =
    "SALE_PAYMENT_TOTAL_MISMATCH";

  constructor(
    public readonly saleTotal: number,
    public readonly paymentTotal: number,
  ) {
    super(
      `La suma de los pagos (${paymentTotal.toFixed(2)}) debe coincidir con el total de la venta (${saleTotal.toFixed(2)}).`,
    );

    this.name =
      "SalePaymentTotalMismatchError";
  }
}


export class SaleCreditRequiresClientError extends Error {
  readonly code =
    "SALE_CREDIT_REQUIRES_CLIENT";

  constructor() {
    super(
      "Una venta con pago a crédito requiere un cliente asociado.",
    );

    this.name =
      "SaleCreditRequiresClientError";
  }
}

export class SaleCashSessionConflictError extends Error {
  readonly code =
    "SALE_CASH_SESSION_NOT_OPEN";

  constructor(
    public readonly sesionCajaId: bigint,
  ) {
    super(
      "No se puede revertir el efectivo porque la sesión de caja asociada ya no se encuentra abierta.",
    );

    this.name =
      "SaleCashSessionConflictError";
  }
}

export class InsufficientStockError extends Error {
  readonly code =
    "INSUFFICIENT_STOCK";

  constructor(
    public readonly productoId: bigint,
    public readonly sku: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `Existencia insuficiente para el producto ${sku}. Solicitado: ${requested}. Disponible: ${available}.`,
    );

    this.name =
      "InsufficientStockError";
  }
}

export class SaleNotFoundError extends Error {
  readonly code =
    "SALE_NOT_FOUND";

  constructor() {
    super(
      "La venta indicada no existe.",
    );

    this.name =
      "SaleNotFoundError";
  }
}

export class SaleCancellationConflictError extends Error {
  readonly code =
    "SALE_CANNOT_BE_CANCELLED";

  constructor(
    public readonly currentStatus: string,
  ) {
    super(
      currentStatus === "CANCELADA"
        ? "La venta ya se encuentra cancelada."
        : `La venta no puede cancelarse porque su estado actual es ${currentStatus}.`,
    );

    this.name =
      "SaleCancellationConflictError";
  }
}

export class SaleHasReturnsError extends Error {
  readonly code =
    "SALE_HAS_RETURNS";

  constructor() {
    super(
      "La venta no puede cancelarse porque ya tiene una o más devoluciones registradas.",
    );

    this.name =
      "SaleHasReturnsError";
  }
}
