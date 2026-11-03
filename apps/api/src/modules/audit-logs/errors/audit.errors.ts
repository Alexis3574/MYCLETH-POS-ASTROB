export class AuditNotFoundError extends Error {
  readonly code = "AUDIT_NOT_FOUND";
  readonly status = 404;

  constructor() {
    super(
      "El evento de auditoria no existe o no esta disponible."
    );
    this.name = "AuditNotFoundError";
  }
}
