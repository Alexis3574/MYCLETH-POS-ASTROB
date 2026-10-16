export class ProductError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field: string | undefined;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = "ProductError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export function productNotFound(): ProductError {
  return new ProductError(404, "PRODUCT_NOT_FOUND", "Producto no encontrado.");
}
