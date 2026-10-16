export class CustomerError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CustomerError";
  }
}

export const customerError = {
  notFound: () => new CustomerError(404, "CUSTOMER_NOT_FOUND", "El cliente o la dirección solicitada no existe."),
  conflict: (message: string) => new CustomerError(409, "CUSTOMER_CONFLICT", message),
};
