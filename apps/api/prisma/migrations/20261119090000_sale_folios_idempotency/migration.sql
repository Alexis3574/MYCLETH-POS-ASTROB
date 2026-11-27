-- Preparada para revisión. No aplicar sin autorización del entorno.
CREATE TABLE pos.folio_documento (
  empresa_id BIGINT NOT NULL, sucursal_id BIGINT NOT NULL,
  tipo VARCHAR(30) NOT NULL, periodo VARCHAR(8) NOT NULL,
  ultimo BIGINT NOT NULL CHECK (ultimo > 0),
  PRIMARY KEY (empresa_id, sucursal_id, tipo, periodo)
);
CREATE TABLE pos.operacion_venta (
  empresa_id BIGINT NOT NULL, usuario_id BIGINT NOT NULL, sucursal_id BIGINT NOT NULL,
  clave_idempotencia UUID NOT NULL, venta_id BIGINT NOT NULL,
  request_hash VARCHAR(64) NOT NULL, respuesta JSONB NOT NULL,
  creado_en TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id, clave_idempotencia),
  CONSTRAINT operacion_venta_venta_fkey FOREIGN KEY (venta_id) REFERENCES pos.venta(id) ON DELETE RESTRICT
);
CREATE INDEX idx_operacion_venta_venta ON pos.operacion_venta(venta_id);
