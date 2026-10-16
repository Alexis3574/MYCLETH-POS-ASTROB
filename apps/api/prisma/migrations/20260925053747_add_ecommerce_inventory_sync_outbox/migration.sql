-- CreateTable
CREATE TABLE "sincronizacion_ecommerce_inventario" (
    "id" BIGSERIAL NOT NULL,
    "movimiento_inventario_id" BIGINT NOT NULL,
    "operation_id" VARCHAR(120) NOT NULL,
    "codigo_barras" VARCHAR(80),
    "sku" VARCHAR(80) NOT NULL,
    "adjustment" INTEGER NOT NULL,
    "ecommerce_product_id" BIGINT,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ultimo_error" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_intento_en" TIMESTAMPTZ(6),
    "sincronizado_en" TIMESTAMPTZ(6),

    CONSTRAINT "sincronizacion_ecommerce_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sincronizacion_ecommerce_inventario_movimiento_inventario_i_key" ON "sincronizacion_ecommerce_inventario"("movimiento_inventario_id");

-- CreateIndex
CREATE UNIQUE INDEX "sincronizacion_ecommerce_inventario_operation_id_key" ON "sincronizacion_ecommerce_inventario"("operation_id");

-- CreateIndex
CREATE INDEX "idx_sync_ecommerce_estado_creado" ON "sincronizacion_ecommerce_inventario"("estado", "creado_en");

-- AddForeignKey
ALTER TABLE "sincronizacion_ecommerce_inventario" ADD CONSTRAINT "sincronizacion_ecommerce_inventario_movimiento_inventario__fkey" FOREIGN KEY ("movimiento_inventario_id") REFERENCES "movimiento_inventario"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
