-- Módulo 7. Migración preparada; no ejecutar en producción sin revisar.
-- Tabla aislada para idempotencia de mutaciones de Compras.
CREATE TABLE "pos"."operacion_compra" (
    "id" BIGSERIAL PRIMARY KEY,
    "empresa_id" BIGINT NOT NULL,
    "usuario_id" BIGINT NOT NULL,
    "compra_id" BIGINT NOT NULL,
    "accion" VARCHAR(20) NOT NULL,
    "clave_idempotencia" VARCHAR(100) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "respuesta" JSONB NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "operacion_compra_accion_check"
      CHECK ("accion" IN ('CREAR','RECIBIR','PAGAR','CANCELAR')),
    CONSTRAINT "uq_operacion_compra_empresa_clave" UNIQUE ("empresa_id", "clave_idempotencia"),
    CONSTRAINT "operacion_compra_empresa_fk" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id"),
    CONSTRAINT "operacion_compra_usuario_fk" FOREIGN KEY ("usuario_id") REFERENCES "pos"."usuario"("id"),
    CONSTRAINT "operacion_compra_compra_fk" FOREIGN KEY ("compra_id") REFERENCES "pos"."compra"("id")
);
CREATE INDEX "idx_operacion_compra_compra" ON "pos"."operacion_compra" ("compra_id", "creado_en");
