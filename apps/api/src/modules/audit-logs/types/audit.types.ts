export interface AuditActor {
  empresaId: bigint;
  userId: bigint;
}

export interface AuditDatabaseRow {
  id: bigint;
  usuario_id: bigint;
  tabla: string;
  registro_id: bigint | null;
  accion: string;
  creado_en: Date;
  sucursal_id: bigint;
  username: string;
}

export interface AuditDetailRow extends AuditDatabaseRow {
  datos_anteriores: unknown;
  datos_nuevos: unknown;
}

export interface AuditCountRow {
  total: bigint;
}
