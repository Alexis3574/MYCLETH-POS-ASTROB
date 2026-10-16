
export class SupplierError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SupplierError";
  }
}

export const supplierError = {
  notFound: () => new SupplierError(404, "SUPPLIER_NOT_FOUND", "El proveedor o la dirección indicada no existe."),
  conflict: (message: string) => new SupplierError(409, "SUPPLIER_CONFLICT", message),
};
