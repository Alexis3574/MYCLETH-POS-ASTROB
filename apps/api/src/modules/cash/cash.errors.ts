export class CashError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CashError";
  }
}

export const cashError = {
  notFound: () => new CashError(404, "CASH_NOT_FOUND", "La caja o la sesión solicitada no existe en su ámbito de acceso."),
  forbidden: () => new CashError(403, "CASH_BRANCH_FORBIDDEN", "No tiene acceso a esta sucursal."),
  conflict: (message: string) => new CashError(409, "CASH_CONFLICT", message),
};
