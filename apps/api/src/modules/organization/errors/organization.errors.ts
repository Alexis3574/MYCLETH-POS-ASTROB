export class OrganizationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "OrganizationError";
  }
}
export const organizationError = {
  notFound: (kind: string) => new OrganizationError(404, "ORGANIZATION_NOT_FOUND", `${kind} no encontrado en la empresa.`),
  conflict: (message: string) => new OrganizationError(409, "ORGANIZATION_CONFLICT", message),
  forbidden: () => new OrganizationError(403, "ORGANIZATION_FORBIDDEN", "Usuario o empresa no disponible."),
};
export function isDatabaseConflict(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === code) return true;
  if ("meta" in error && error.meta && typeof error.meta === "object") {
    return isDatabaseConflict(error.meta, code);
  }
  if ("driverAdapterError" in error) return isDatabaseConflict(error.driverAdapterError, code);
  if ("cause" in error) return isDatabaseConflict(error.cause, code);
  if ("originalCode" in error && error.originalCode === code) return true;
  return false;
}
