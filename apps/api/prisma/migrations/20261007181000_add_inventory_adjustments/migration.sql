-- La aplicación de stock sigue siendo responsabilidad del trigger existente.
-- No se modifica existencia, sus columnas generadas ni la outbox de Ecommerce.
CREATE TABLE "pos"."ajuste_inventario" (
    "id" BIGSERIAL PRIMARY KEY,
    "empresa_id" BIGINT NOT NULL REFERENCES "pos"."empresa"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    "almacen_id" BIGINT NOT NULL REFERENCES "pos"."almacen"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    "producto_id" BIGINT NOT NULL REFERENCES "pos"."producto"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    "usuario_id" BIGINT NOT NULL REFERENCES "pos"."usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    "clave_idempotencia" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "cantidad" NUMERIC(14,3) NOT NULL,
    "costo_unitario" NUMERIC(14,4),
    "motivo" VARCHAR(1000) NOT NULL,
    "sincronizar_ecommerce" BOOLEAN NOT NULL,
    "movimiento_inventario_id" BIGINT NOT NULL REFERENCES "pos"."movimiento_inventario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    "respuesta" JSONB NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "uq_ajuste_movimiento" UNIQUE ("movimiento_inventario_id"),
    CONSTRAINT "uq_ajuste_empresa_idempotencia" UNIQUE ("empresa_id", "clave_idempotencia"),
    CONSTRAINT "ck_ajuste_tipo" CHECK ("tipo" IN ('AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO')),
    CONSTRAINT "ck_ajuste_cantidad" CHECK ("cantidad" > 0),
    CONSTRAINT "ck_ajuste_costo" CHECK ("costo_unitario" IS NULL OR "costo_unitario" >= 0),
    CONSTRAINT "ck_ajuste_costo_salida" CHECK ("tipo" = 'AJUSTE_POSITIVO' OR "costo_unitario" IS NULL),
    CONSTRAINT "ck_ajuste_motivo" CHECK (length(btrim("motivo")) > 0),
    CONSTRAINT "ck_ajuste_hash" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ck_ajuste_respuesta" CHECK (jsonb_typeof("respuesta") = 'object'),
    CONSTRAINT "ck_ajuste_sync_entero" CHECK (NOT "sincronizar_ecommerce" OR ("cantidad" = trunc("cantidad") AND "cantidad" <= 2147483647))
);

CREATE INDEX "idx_ajuste_empresa_almacen_fecha"
ON "pos"."ajuste_inventario"("empresa_id", "almacen_id", "creado_en" DESC);
