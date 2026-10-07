export class SaleReturnNotFoundError extends Error {
  readonly code = "SALE_NOT_FOUND";

  constructor() {
    super("La venta indicada no existe.");
    this.name = "SaleReturnNotFoundError";
  }
}

export class SaleReturnNotAllowedError extends Error {
  readonly code = "SALE_RETURN_NOT_ALLOWED";

  constructor(
    public readonly currentStatus: string,
  ) {
    super(
      `La venta no admite devoluciones porque su estado actual es ${currentStatus}.`,
    );

    this.name = "SaleReturnNotAllowedError";
  }
}

export class SaleReturnContextError extends Error {
  readonly code = "INVALID_RETURN_CONTEXT";

  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "SaleReturnContextError";
  }
}

export class SaleReturnDetailError extends Error {
  readonly code = "INVALID_RETURN_DETAIL";

  constructor(
    public readonly saleDetailId: bigint,
  ) {
    super(
      "El detalle indicado no pertenece a la venta.",
    );

    this.name = "SaleReturnDetailError";
  }
}

export class SaleReturnDuplicateDetailError extends Error {
  readonly code = "DUPLICATE_RETURN_DETAIL";

  constructor(
    public readonly saleDetailId: bigint,
  ) {
    super(
      "Un detalle de venta no puede aparecer dos veces en la misma devolución.",
    );

    this.name = "SaleReturnDuplicateDetailError";
  }
}

export class SaleReturnQuantityExceededError extends Error {
  readonly code = "RETURN_QUANTITY_EXCEEDED";

  constructor(
    public readonly saleDetailId: bigint,
    public readonly sold: number,
    public readonly alreadyReturned: number,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `La cantidad solicitada para devolución (${requested}) supera la cantidad disponible (${available}).`,
    );

    this.name = "SaleReturnQuantityExceededError";
  }
}

export class SaleReturnPaymentError extends Error {
  readonly code = "INVALID_RETURN_PAYMENT";

  constructor(
    public readonly salePaymentId: bigint,
  ) {
    super(
      "El pago indicado no pertenece a la venta.",
    );

    this.name = "SaleReturnPaymentError";
  }
}

export class SaleReturnDuplicatePaymentError extends Error {
  readonly code = "DUPLICATE_RETURN_PAYMENT";

  constructor(
    public readonly salePaymentId: bigint,
  ) {
    super(
      "Un pago no puede aparecer dos veces en la misma devolución.",
    );

    this.name = "SaleReturnDuplicatePaymentError";
  }
}

export class SaleReturnPaymentExceededError extends Error {
  readonly code = "RETURN_PAYMENT_EXCEEDED";

  constructor(
    public readonly salePaymentId: bigint,
    public readonly originalAmount: number,
    public readonly alreadyRefunded: number,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(
      `El reembolso solicitado (${requested.toFixed(2)}) supera el monto todavía reembolsable (${available.toFixed(2)}).`,
    );

    this.name = "SaleReturnPaymentExceededError";
  }
}

export class SaleReturnPaymentTotalMismatchError extends Error {
  readonly code = "RETURN_PAYMENT_TOTAL_MISMATCH";

  constructor(
    public readonly returnTotal: number,
    public readonly refundTotal: number,
  ) {
    super(
      `La suma de los reembolsos (${refundTotal.toFixed(2)}) debe coincidir con el total de la devolución (${returnTotal.toFixed(2)}).`,
    );

    this.name = "SaleReturnPaymentTotalMismatchError";
  }
}

export class SaleReturnQuerySaleNotFoundError extends Error {
  readonly code = "SALE_NOT_FOUND";

  constructor() {
    super("La venta indicada no existe.");
    this.name = "SaleReturnQuerySaleNotFoundError";
  }
}

export class SaleReturnQueryNotFoundError extends Error {
  readonly code = "SALE_RETURN_NOT_FOUND";

  constructor() {
    super(
      "La devolución indicada no existe o no pertenece a la venta.",
    );

    this.name = "SaleReturnQueryNotFoundError";
  }
}