-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "pos";

-- CreateTable
CREATE TABLE "pos"."almacen" (
    "id" BIGSERIAL NOT NULL,
    "sucursal_id" BIGINT NOT NULL,
    "codigo" VARCHAR(30) NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "almacen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."auditoria" (
    "id" BIGSERIAL NOT NULL,
    "usuario_id" BIGINT,
    "tabla" VARCHAR(100) NOT NULL,
    "registro_id" BIGINT,
    "accion" VARCHAR(20) NOT NULL,
    "datos_anteriores" JSONB,
    "datos_nuevos" JSONB,
    "ip_origen" INET,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."caja" (
    "id" BIGSERIAL NOT NULL,
    "sucursal_id" BIGINT NOT NULL,
    "codigo" VARCHAR(30) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."categoria" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "categoria_padre_id" BIGINT,
    "nombre" VARCHAR(120) NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."cliente" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "codigo" VARCHAR(40) NOT NULL,
    "nombre" VARCHAR(180) NOT NULL,
    "rfc" VARCHAR(20),
    "email" VARCHAR(180),
    "telefono" VARCHAR(30),
    "limite_credito" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dias_credito" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."cliente_direccion" (
    "id" BIGSERIAL NOT NULL,
    "cliente_id" BIGINT NOT NULL,
    "tipo" VARCHAR(20) NOT NULL DEFAULT 'FISCAL',
    "calle" VARCHAR(180),
    "numero_exterior" VARCHAR(30),
    "numero_interior" VARCHAR(30),
    "colonia" VARCHAR(120),
    "municipio" VARCHAR(120),
    "estado" VARCHAR(120),
    "codigo_postal" VARCHAR(15),
    "pais" VARCHAR(80) NOT NULL DEFAULT 'MÃ©xico',
    "es_principal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "cliente_direccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."compra" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "sucursal_id" BIGINT NOT NULL,
    "almacen_id" BIGINT NOT NULL,
    "proveedor_id" BIGINT NOT NULL,
    "usuario_id" BIGINT NOT NULL,
    "folio" VARCHAR(50) NOT NULL,
    "factura_proveedor" VARCHAR(80),
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "descuento" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impuesto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observaciones" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."compra_detalle" (
    "id" BIGSERIAL NOT NULL,
    "compra_id" BIGINT NOT NULL,
    "producto_id" BIGINT NOT NULL,
    "descripcion" VARCHAR(250),
    "cantidad" DECIMAL(14,3) NOT NULL,
    "precio_unitario" DECIMAL(14,4) NOT NULL,
    "descuento_porcentaje" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tasa_impuesto" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "subtotal_linea" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "descuento_importe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impuesto_importe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_linea" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "compra_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."compra_pago" (
    "id" BIGSERIAL NOT NULL,
    "compra_id" BIGINT NOT NULL,
    "metodo_pago_id" BIGINT NOT NULL,
    "sesion_caja_id" BIGINT,
    "monto" DECIMAL(14,2) NOT NULL,
    "referencia" VARCHAR(150),
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compra_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."configuracion_empresa" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "clave" VARCHAR(120) NOT NULL,
    "valor" JSONB NOT NULL DEFAULT '{}',
    "descripcion" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuracion_empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."cotizacion" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "sucursal_id" BIGINT NOT NULL,
    "cliente_id" BIGINT,
    "usuario_id" BIGINT NOT NULL,
    "folio" VARCHAR(50) NOT NULL,
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valida_hasta" DATE,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "descuento" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impuesto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observaciones" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cotizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."cotizacion_detalle" (
    "id" BIGSERIAL NOT NULL,
    "cotizacion_id" BIGINT NOT NULL,
    "producto_id" BIGINT NOT NULL,
    "descripcion" VARCHAR(250),
    "cantidad" DECIMAL(14,3) NOT NULL,
    "precio_unitario" DECIMAL(14,4) NOT NULL,
    "descuento_porcentaje" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tasa_impuesto" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "subtotal_linea" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "descuento_importe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impuesto_importe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_linea" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "cotizacion_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."empresa" (
    "id" BIGSERIAL NOT NULL,
    "razon_social" VARCHAR(180) NOT NULL,
    "nombre_comercial" VARCHAR(180) NOT NULL,
    "rfc" VARCHAR(20),
    "telefono" VARCHAR(30),
    "email" VARCHAR(180),
    "direccion" TEXT,
    "moneda" CHAR(3) NOT NULL DEFAULT 'MXN',
    "zona_horaria" VARCHAR(80) NOT NULL DEFAULT 'America/Mexico_City',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."existencia" (
    "producto_id" BIGINT NOT NULL,
    "almacen_id" BIGINT NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reservado" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "disponible" DECIMAL(14,3) GENERATED ALWAYS AS (cantidad - reservado) STORED,
    "costo_promedio" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "existencia_pkey" PRIMARY KEY ("producto_id","almacen_id")
);

-- CreateTable
CREATE TABLE "pos"."impuesto" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "codigo" VARCHAR(30) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "tasa" DECIMAL(7,4) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impuesto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."metodo_pago" (
    "id" BIGSERIAL NOT NULL,
    "codigo" VARCHAR(30) NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "es_efectivo" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "metodo_pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."movimiento_caja" (
    "id" BIGSERIAL NOT NULL,
    "sesion_caja_id" BIGINT NOT NULL,
    "usuario_id" BIGINT NOT NULL,
    "tipo" VARCHAR(10) NOT NULL,
    "concepto" VARCHAR(180) NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "referencia" VARCHAR(120),
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimiento_caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."movimiento_inventario" (
    "id" BIGSERIAL NOT NULL,
    "producto_id" BIGINT NOT NULL,
    "almacen_id" BIGINT NOT NULL,
    "usuario_id" BIGINT,
    "tipo" VARCHAR(30) NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "costo_unitario" DECIMAL(14,4),
    "documento_tipo" VARCHAR(50),
    "documento_id" BIGINT,
    "documento_detalle_id" BIGINT,
    "motivo" TEXT,
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimiento_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."orden_venta" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "sucursal_id" BIGINT NOT NULL,
    "cliente_id" BIGINT,
    "usuario_id" BIGINT NOT NULL,
    "cotizacion_id" BIGINT,
    "folio" VARCHAR(50) NOT NULL,
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_compromiso" DATE,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "descuento" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impuesto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observaciones" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orden_venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."orden_venta_detalle" (
    "id" BIGSERIAL NOT NULL,
    "orden_venta_id" BIGINT NOT NULL,
    "producto_id" BIGINT NOT NULL,
    "descripcion" VARCHAR(250),
    "cantidad" DECIMAL(14,3) NOT NULL,
    "precio_unitario" DECIMAL(14,4) NOT NULL,
    "descuento_porcentaje" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tasa_impuesto" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "subtotal_linea" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "descuento_importe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impuesto_importe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_linea" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "orden_venta_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."pedido_cliente" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "sucursal_id" BIGINT NOT NULL,
    "cliente_id" BIGINT NOT NULL,
    "usuario_id" BIGINT NOT NULL,
    "folio" VARCHAR(50) NOT NULL,
    "referencia_cliente" VARCHAR(100),
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_entrega" DATE,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "descuento" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impuesto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observaciones" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedido_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."pedido_cliente_detalle" (
    "id" BIGSERIAL NOT NULL,
    "pedido_cliente_id" BIGINT NOT NULL,
    "producto_id" BIGINT NOT NULL,
    "descripcion" VARCHAR(250),
    "cantidad" DECIMAL(14,3) NOT NULL,
    "precio_unitario" DECIMAL(14,4) NOT NULL,
    "descuento_porcentaje" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tasa_impuesto" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "subtotal_linea" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "descuento_importe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impuesto_importe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_linea" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "pedido_cliente_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."permiso" (
    "id" BIGSERIAL NOT NULL,
    "codigo" VARCHAR(100) NOT NULL,
    "modulo" VARCHAR(80) NOT NULL,
    "descripcion" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permiso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."producto" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "categoria_id" BIGINT,
    "unidad_medida_id" BIGINT NOT NULL,
    "sku" VARCHAR(80) NOT NULL,
    "codigo_barras" VARCHAR(80),
    "nombre" VARCHAR(180) NOT NULL,
    "descripcion" TEXT,
    "tipo" VARCHAR(20) NOT NULL DEFAULT 'PRODUCTO',
    "controla_inventario" BOOLEAN NOT NULL DEFAULT true,
    "costo_referencia" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "precio_venta" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "stock_minimo" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "stock_maximo" DECIMAL(14,3),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."producto_impuesto" (
    "producto_id" BIGINT NOT NULL,
    "impuesto_id" BIGINT NOT NULL,

    CONSTRAINT "producto_impuesto_pkey" PRIMARY KEY ("producto_id","impuesto_id")
);

-- CreateTable
CREATE TABLE "pos"."proveedor" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "codigo" VARCHAR(40) NOT NULL,
    "razon_social" VARCHAR(180) NOT NULL,
    "nombre_comercial" VARCHAR(180),
    "rfc" VARCHAR(20),
    "email" VARCHAR(180),
    "telefono" VARCHAR(30),
    "contacto" VARCHAR(180),
    "dias_credito" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."proveedor_direccion" (
    "id" BIGSERIAL NOT NULL,
    "proveedor_id" BIGINT NOT NULL,
    "tipo" VARCHAR(20) NOT NULL DEFAULT 'FISCAL',
    "calle" VARCHAR(180),
    "numero_exterior" VARCHAR(30),
    "numero_interior" VARCHAR(30),
    "colonia" VARCHAR(120),
    "municipio" VARCHAR(120),
    "estado" VARCHAR(120),
    "codigo_postal" VARCHAR(15),
    "pais" VARCHAR(80) NOT NULL DEFAULT 'MÃ©xico',
    "es_principal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "proveedor_direccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."rol" (
    "id" BIGSERIAL NOT NULL,
    "codigo" VARCHAR(60) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."rol_permiso" (
    "rol_id" BIGINT NOT NULL,
    "permiso_id" BIGINT NOT NULL,

    CONSTRAINT "rol_permiso_pkey" PRIMARY KEY ("rol_id","permiso_id")
);

-- CreateTable
CREATE TABLE "pos"."sesion_caja" (
    "id" BIGSERIAL NOT NULL,
    "caja_id" BIGINT NOT NULL,
    "usuario_apertura_id" BIGINT NOT NULL,
    "usuario_cierre_id" BIGINT,
    "fecha_apertura" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_cierre" TIMESTAMPTZ(6),
    "monto_apertura" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "monto_esperado" DECIMAL(14,2),
    "monto_cierre" DECIMAL(14,2),
    "diferencia" DECIMAL(14,2),
    "estado" VARCHAR(20) NOT NULL DEFAULT 'ABIERTA',
    "notas" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sesion_caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."sucursal" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "codigo" VARCHAR(30) NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "telefono" VARCHAR(30),
    "email" VARCHAR(180),
    "direccion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sucursal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."transferencia_almacen" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "almacen_origen_id" BIGINT NOT NULL,
    "almacen_destino_id" BIGINT NOT NULL,
    "usuario_id" BIGINT NOT NULL,
    "folio" VARCHAR(50) NOT NULL,
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    "observaciones" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transferencia_almacen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."transferencia_detalle" (
    "id" BIGSERIAL NOT NULL,
    "transferencia_id" BIGINT NOT NULL,
    "producto_id" BIGINT NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "transferencia_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."unidad_medida" (
    "id" BIGSERIAL NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "permite_decimales" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "unidad_medida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."usuario" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "username" VARCHAR(80) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "apellido" VARCHAR(120),
    "email" VARCHAR(180),
    "telefono" VARCHAR(30),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "intentos_fallidos" INTEGER NOT NULL DEFAULT 0,
    "ultimo_acceso" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."usuario_rol" (
    "usuario_id" BIGINT NOT NULL,
    "rol_id" BIGINT NOT NULL,

    CONSTRAINT "usuario_rol_pkey" PRIMARY KEY ("usuario_id","rol_id")
);

-- CreateTable
CREATE TABLE "pos"."usuario_sucursal" (
    "usuario_id" BIGINT NOT NULL,
    "sucursal_id" BIGINT NOT NULL,
    "es_predeterminada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "usuario_sucursal_pkey" PRIMARY KEY ("usuario_id","sucursal_id")
);

-- CreateTable
CREATE TABLE "pos"."venta" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" BIGINT NOT NULL,
    "sucursal_id" BIGINT NOT NULL,
    "almacen_id" BIGINT NOT NULL,
    "cliente_id" BIGINT,
    "usuario_id" BIGINT NOT NULL,
    "sesion_caja_id" BIGINT,
    "cotizacion_id" BIGINT,
    "orden_venta_id" BIGINT,
    "pedido_cliente_id" BIGINT,
    "folio" VARCHAR(50) NOT NULL,
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "condicion_pago" VARCHAR(20) NOT NULL DEFAULT 'CONTADO',
    "estado" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "descuento" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impuesto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observaciones" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."venta_detalle" (
    "id" BIGSERIAL NOT NULL,
    "venta_id" BIGINT NOT NULL,
    "producto_id" BIGINT NOT NULL,
    "descripcion" VARCHAR(250),
    "cantidad" DECIMAL(14,3) NOT NULL,
    "precio_unitario" DECIMAL(14,4) NOT NULL,
    "costo_unitario" DECIMAL(14,4),
    "descuento_porcentaje" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tasa_impuesto" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "subtotal_linea" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "descuento_importe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "impuesto_importe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_linea" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "venta_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos"."venta_pago" (
    "id" BIGSERIAL NOT NULL,
    "venta_id" BIGINT NOT NULL,
    "metodo_pago_id" BIGINT NOT NULL,
    "sesion_caja_id" BIGINT,
    "monto" DECIMAL(14,2) NOT NULL,
    "referencia" VARCHAR(150),
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venta_pago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_almacen_sucursal" ON "pos"."almacen"("sucursal_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_almacen_sucursal_codigo" ON "pos"."almacen"("sucursal_id" ASC, "codigo" ASC);

-- CreateIndex
CREATE INDEX "idx_auditoria_tabla_registro" ON "pos"."auditoria"("tabla" ASC, "registro_id" ASC, "creado_en" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_caja_sucursal_codigo" ON "pos"."caja"("sucursal_id" ASC, "codigo" ASC);

-- CreateIndex
CREATE INDEX "idx_categoria_empresa" ON "pos"."categoria"("empresa_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_categoria_empresa_nombre" ON "pos"."categoria"("empresa_id" ASC, "nombre" ASC);

-- CreateIndex
CREATE INDEX "idx_cliente_empresa" ON "pos"."cliente"("empresa_id" ASC);

-- CreateIndex
CREATE INDEX "idx_cliente_nombre" ON "pos"."cliente"("nombre" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_cliente_empresa_codigo" ON "pos"."cliente"("empresa_id" ASC, "codigo" ASC);

-- CreateIndex
CREATE INDEX "idx_compra_estado_fecha" ON "pos"."compra"("estado" ASC, "fecha" DESC);

-- CreateIndex
CREATE INDEX "idx_compra_fecha" ON "pos"."compra"("fecha" DESC);

-- CreateIndex
CREATE INDEX "idx_compra_proveedor_fecha" ON "pos"."compra"("proveedor_id" ASC, "fecha" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_compra_sucursal_folio" ON "pos"."compra"("sucursal_id" ASC, "folio" ASC);

-- CreateIndex
CREATE INDEX "idx_compra_detalle_producto" ON "pos"."compra_detalle"("producto_id" ASC);

-- CreateIndex
CREATE INDEX "idx_compra_pago_compra" ON "pos"."compra_pago"("compra_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_configuracion_empresa_clave" ON "pos"."configuracion_empresa"("empresa_id" ASC, "clave" ASC);

-- CreateIndex
CREATE INDEX "idx_cotizacion_cliente_fecha" ON "pos"."cotizacion"("cliente_id" ASC, "fecha" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_cotizacion_sucursal_folio" ON "pos"."cotizacion"("sucursal_id" ASC, "folio" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_empresa_rfc" ON "pos"."empresa"("rfc" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_impuesto_empresa_codigo" ON "pos"."impuesto"("empresa_id" ASC, "codigo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "metodo_pago_codigo_key" ON "pos"."metodo_pago"("codigo" ASC);

-- CreateIndex
CREATE INDEX "idx_movimiento_caja_sesion_fecha" ON "pos"."movimiento_caja"("sesion_caja_id" ASC, "fecha" DESC);

-- CreateIndex
CREATE INDEX "idx_movimiento_inv_documento" ON "pos"."movimiento_inventario"("documento_tipo" ASC, "documento_id" ASC);

-- CreateIndex
CREATE INDEX "idx_movimiento_inv_producto_almacen_fecha" ON "pos"."movimiento_inventario"("producto_id" ASC, "almacen_id" ASC, "fecha" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_movimiento_documento_detalle_tipo" ON "pos"."movimiento_inventario"("documento_tipo" ASC, "documento_detalle_id" ASC, "tipo" ASC, "almacen_id" ASC) WHERE (documento_detalle_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "idx_orden_venta_cliente_fecha" ON "pos"."orden_venta"("cliente_id" ASC, "fecha" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_orden_venta_sucursal_folio" ON "pos"."orden_venta"("sucursal_id" ASC, "folio" ASC);

-- CreateIndex
CREATE INDEX "idx_pedido_cliente_cliente_fecha" ON "pos"."pedido_cliente"("cliente_id" ASC, "fecha" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_pedido_cliente_sucursal_folio" ON "pos"."pedido_cliente"("sucursal_id" ASC, "folio" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "permiso_codigo_key" ON "pos"."permiso"("codigo" ASC);

-- CreateIndex
CREATE INDEX "idx_producto_categoria" ON "pos"."producto"("categoria_id" ASC);

-- CreateIndex
CREATE INDEX "idx_producto_codigo_barras" ON "pos"."producto"("codigo_barras" ASC);

-- CreateIndex
CREATE INDEX "idx_producto_empresa" ON "pos"."producto"("empresa_id" ASC);

-- CreateIndex
CREATE INDEX "idx_producto_nombre" ON "pos"."producto"("nombre" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_producto_empresa_codigo_barras" ON "pos"."producto"("empresa_id" ASC, "codigo_barras" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_producto_empresa_sku" ON "pos"."producto"("empresa_id" ASC, "sku" ASC);

-- CreateIndex
CREATE INDEX "idx_proveedor_empresa" ON "pos"."proveedor"("empresa_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_proveedor_empresa_codigo" ON "pos"."proveedor"("empresa_id" ASC, "codigo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "rol_codigo_key" ON "pos"."rol"("codigo" ASC);

-- CreateIndex
CREATE INDEX "idx_sesion_caja_caja_fecha" ON "pos"."sesion_caja"("caja_id" ASC, "fecha_apertura" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_sesion_caja_abierta" ON "pos"."sesion_caja"("caja_id" ASC) WHERE ((estado)::text = 'ABIERTA'::text);

-- CreateIndex
CREATE INDEX "idx_sucursal_empresa" ON "pos"."sucursal"("empresa_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_sucursal_empresa_codigo" ON "pos"."sucursal"("empresa_id" ASC, "codigo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_transferencia_empresa_folio" ON "pos"."transferencia_almacen"("empresa_id" ASC, "folio" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_transferencia_detalle_producto" ON "pos"."transferencia_detalle"("transferencia_id" ASC, "producto_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "unidad_medida_codigo_key" ON "pos"."unidad_medida"("codigo" ASC);

-- CreateIndex
CREATE INDEX "idx_usuario_empresa" ON "pos"."usuario"("empresa_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_usuario_empresa_email" ON "pos"."usuario"("empresa_id" ASC, "email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_usuario_empresa_username" ON "pos"."usuario"("empresa_id" ASC, "username" ASC);

-- CreateIndex
CREATE INDEX "idx_usuario_rol_rol" ON "pos"."usuario_rol"("rol_id" ASC);

-- CreateIndex
CREATE INDEX "idx_venta_cliente_fecha" ON "pos"."venta"("cliente_id" ASC, "fecha" DESC);

-- CreateIndex
CREATE INDEX "idx_venta_estado_fecha" ON "pos"."venta"("estado" ASC, "fecha" DESC);

-- CreateIndex
CREATE INDEX "idx_venta_fecha" ON "pos"."venta"("fecha" DESC);

-- CreateIndex
CREATE INDEX "idx_venta_usuario_fecha" ON "pos"."venta"("usuario_id" ASC, "fecha" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_venta_sucursal_folio" ON "pos"."venta"("sucursal_id" ASC, "folio" ASC);

-- CreateIndex
CREATE INDEX "idx_venta_detalle_producto" ON "pos"."venta_detalle"("producto_id" ASC);

-- CreateIndex
CREATE INDEX "idx_venta_pago_venta" ON "pos"."venta_pago"("venta_id" ASC);

-- AddForeignKey
ALTER TABLE "pos"."almacen" ADD CONSTRAINT "almacen_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "pos"."sucursal"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."auditoria" ADD CONSTRAINT "auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "pos"."usuario"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."caja" ADD CONSTRAINT "caja_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "pos"."sucursal"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."categoria" ADD CONSTRAINT "categoria_categoria_padre_id_fkey" FOREIGN KEY ("categoria_padre_id") REFERENCES "pos"."categoria"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."categoria" ADD CONSTRAINT "categoria_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."cliente" ADD CONSTRAINT "cliente_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."cliente_direccion" ADD CONSTRAINT "cliente_direccion_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "pos"."cliente"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."compra" ADD CONSTRAINT "compra_almacen_id_fkey" FOREIGN KEY ("almacen_id") REFERENCES "pos"."almacen"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."compra" ADD CONSTRAINT "compra_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."compra" ADD CONSTRAINT "compra_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "pos"."proveedor"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."compra" ADD CONSTRAINT "compra_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "pos"."sucursal"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."compra" ADD CONSTRAINT "compra_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "pos"."usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."compra_detalle" ADD CONSTRAINT "compra_detalle_compra_id_fkey" FOREIGN KEY ("compra_id") REFERENCES "pos"."compra"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."compra_detalle" ADD CONSTRAINT "compra_detalle_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "pos"."producto"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."compra_pago" ADD CONSTRAINT "compra_pago_compra_id_fkey" FOREIGN KEY ("compra_id") REFERENCES "pos"."compra"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."compra_pago" ADD CONSTRAINT "compra_pago_metodo_pago_id_fkey" FOREIGN KEY ("metodo_pago_id") REFERENCES "pos"."metodo_pago"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."compra_pago" ADD CONSTRAINT "compra_pago_sesion_caja_id_fkey" FOREIGN KEY ("sesion_caja_id") REFERENCES "pos"."sesion_caja"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."configuracion_empresa" ADD CONSTRAINT "configuracion_empresa_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."cotizacion" ADD CONSTRAINT "cotizacion_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "pos"."cliente"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."cotizacion" ADD CONSTRAINT "cotizacion_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."cotizacion" ADD CONSTRAINT "cotizacion_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "pos"."sucursal"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."cotizacion" ADD CONSTRAINT "cotizacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "pos"."usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."cotizacion_detalle" ADD CONSTRAINT "cotizacion_detalle_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "pos"."cotizacion"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."cotizacion_detalle" ADD CONSTRAINT "cotizacion_detalle_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "pos"."producto"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."existencia" ADD CONSTRAINT "existencia_almacen_id_fkey" FOREIGN KEY ("almacen_id") REFERENCES "pos"."almacen"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."existencia" ADD CONSTRAINT "existencia_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "pos"."producto"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."impuesto" ADD CONSTRAINT "impuesto_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."movimiento_caja" ADD CONSTRAINT "movimiento_caja_sesion_caja_id_fkey" FOREIGN KEY ("sesion_caja_id") REFERENCES "pos"."sesion_caja"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."movimiento_caja" ADD CONSTRAINT "movimiento_caja_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "pos"."usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."movimiento_inventario" ADD CONSTRAINT "movimiento_inventario_almacen_id_fkey" FOREIGN KEY ("almacen_id") REFERENCES "pos"."almacen"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."movimiento_inventario" ADD CONSTRAINT "movimiento_inventario_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "pos"."producto"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."movimiento_inventario" ADD CONSTRAINT "movimiento_inventario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "pos"."usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."orden_venta" ADD CONSTRAINT "orden_venta_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "pos"."cliente"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."orden_venta" ADD CONSTRAINT "orden_venta_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "pos"."cotizacion"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."orden_venta" ADD CONSTRAINT "orden_venta_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."orden_venta" ADD CONSTRAINT "orden_venta_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "pos"."sucursal"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."orden_venta" ADD CONSTRAINT "orden_venta_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "pos"."usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."orden_venta_detalle" ADD CONSTRAINT "orden_venta_detalle_orden_venta_id_fkey" FOREIGN KEY ("orden_venta_id") REFERENCES "pos"."orden_venta"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."orden_venta_detalle" ADD CONSTRAINT "orden_venta_detalle_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "pos"."producto"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."pedido_cliente" ADD CONSTRAINT "pedido_cliente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "pos"."cliente"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."pedido_cliente" ADD CONSTRAINT "pedido_cliente_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."pedido_cliente" ADD CONSTRAINT "pedido_cliente_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "pos"."sucursal"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."pedido_cliente" ADD CONSTRAINT "pedido_cliente_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "pos"."usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."pedido_cliente_detalle" ADD CONSTRAINT "pedido_cliente_detalle_pedido_cliente_id_fkey" FOREIGN KEY ("pedido_cliente_id") REFERENCES "pos"."pedido_cliente"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."pedido_cliente_detalle" ADD CONSTRAINT "pedido_cliente_detalle_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "pos"."producto"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."producto" ADD CONSTRAINT "producto_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "pos"."categoria"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."producto" ADD CONSTRAINT "producto_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."producto" ADD CONSTRAINT "producto_unidad_medida_id_fkey" FOREIGN KEY ("unidad_medida_id") REFERENCES "pos"."unidad_medida"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."producto_impuesto" ADD CONSTRAINT "producto_impuesto_impuesto_id_fkey" FOREIGN KEY ("impuesto_id") REFERENCES "pos"."impuesto"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."producto_impuesto" ADD CONSTRAINT "producto_impuesto_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "pos"."producto"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."proveedor" ADD CONSTRAINT "proveedor_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."proveedor_direccion" ADD CONSTRAINT "proveedor_direccion_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "pos"."proveedor"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."rol_permiso" ADD CONSTRAINT "rol_permiso_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "pos"."permiso"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."rol_permiso" ADD CONSTRAINT "rol_permiso_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "pos"."rol"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."sesion_caja" ADD CONSTRAINT "sesion_caja_caja_id_fkey" FOREIGN KEY ("caja_id") REFERENCES "pos"."caja"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."sesion_caja" ADD CONSTRAINT "sesion_caja_usuario_apertura_id_fkey" FOREIGN KEY ("usuario_apertura_id") REFERENCES "pos"."usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."sesion_caja" ADD CONSTRAINT "sesion_caja_usuario_cierre_id_fkey" FOREIGN KEY ("usuario_cierre_id") REFERENCES "pos"."usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."sucursal" ADD CONSTRAINT "sucursal_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."transferencia_almacen" ADD CONSTRAINT "transferencia_almacen_almacen_destino_id_fkey" FOREIGN KEY ("almacen_destino_id") REFERENCES "pos"."almacen"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."transferencia_almacen" ADD CONSTRAINT "transferencia_almacen_almacen_origen_id_fkey" FOREIGN KEY ("almacen_origen_id") REFERENCES "pos"."almacen"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."transferencia_almacen" ADD CONSTRAINT "transferencia_almacen_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."transferencia_almacen" ADD CONSTRAINT "transferencia_almacen_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "pos"."usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."transferencia_detalle" ADD CONSTRAINT "transferencia_detalle_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "pos"."producto"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."transferencia_detalle" ADD CONSTRAINT "transferencia_detalle_transferencia_id_fkey" FOREIGN KEY ("transferencia_id") REFERENCES "pos"."transferencia_almacen"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."usuario" ADD CONSTRAINT "usuario_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."usuario_rol" ADD CONSTRAINT "usuario_rol_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "pos"."rol"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."usuario_rol" ADD CONSTRAINT "usuario_rol_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "pos"."usuario"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."usuario_sucursal" ADD CONSTRAINT "usuario_sucursal_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "pos"."sucursal"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."usuario_sucursal" ADD CONSTRAINT "usuario_sucursal_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "pos"."usuario"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."venta" ADD CONSTRAINT "venta_almacen_id_fkey" FOREIGN KEY ("almacen_id") REFERENCES "pos"."almacen"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."venta" ADD CONSTRAINT "venta_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "pos"."cliente"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."venta" ADD CONSTRAINT "venta_cotizacion_id_fkey" FOREIGN KEY ("cotizacion_id") REFERENCES "pos"."cotizacion"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."venta" ADD CONSTRAINT "venta_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "pos"."empresa"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."venta" ADD CONSTRAINT "venta_orden_venta_id_fkey" FOREIGN KEY ("orden_venta_id") REFERENCES "pos"."orden_venta"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."venta" ADD CONSTRAINT "venta_pedido_cliente_id_fkey" FOREIGN KEY ("pedido_cliente_id") REFERENCES "pos"."pedido_cliente"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."venta" ADD CONSTRAINT "venta_sesion_caja_id_fkey" FOREIGN KEY ("sesion_caja_id") REFERENCES "pos"."sesion_caja"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."venta" ADD CONSTRAINT "venta_sucursal_id_fkey" FOREIGN KEY ("sucursal_id") REFERENCES "pos"."sucursal"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."venta" ADD CONSTRAINT "venta_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "pos"."usuario"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."venta_detalle" ADD CONSTRAINT "venta_detalle_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "pos"."producto"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."venta_detalle" ADD CONSTRAINT "venta_detalle_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "pos"."venta"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."venta_pago" ADD CONSTRAINT "venta_pago_metodo_pago_id_fkey" FOREIGN KEY ("metodo_pago_id") REFERENCES "pos"."metodo_pago"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."venta_pago" ADD CONSTRAINT "venta_pago_sesion_caja_id_fkey" FOREIGN KEY ("sesion_caja_id") REFERENCES "pos"."sesion_caja"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pos"."venta_pago" ADD CONSTRAINT "venta_pago_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "pos"."venta"("id") ON DELETE CASCADE ON UPDATE NO ACTION;



-- Existing CHECK constraints
ALTER TABLE pos.auditoria ADD CONSTRAINT auditoria_accion_check CHECK (((accion)::text = ANY ((ARRAY['INSERT'::character varying, 'UPDATE'::character varying, 'DELETE'::character varying, 'LOGIN'::character varying, 'LOGOUT'::character varying, 'OTRA'::character varying])::text[])));
ALTER TABLE pos.cliente ADD CONSTRAINT cliente_dias_credito_check CHECK ((dias_credito >= 0));
ALTER TABLE pos.cliente ADD CONSTRAINT cliente_limite_credito_check CHECK ((limite_credito >= (0)::numeric));
ALTER TABLE pos.cliente_direccion ADD CONSTRAINT cliente_direccion_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['FISCAL'::character varying, 'ENVIO'::character varying, 'OTRA'::character varying])::text[])));
ALTER TABLE pos.compra ADD CONSTRAINT compra_descuento_check CHECK ((descuento >= (0)::numeric));
ALTER TABLE pos.compra ADD CONSTRAINT compra_estado_check CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'RECIBIDA'::character varying, 'CANCELADA'::character varying])::text[])));
ALTER TABLE pos.compra ADD CONSTRAINT compra_impuesto_check CHECK ((impuesto >= (0)::numeric));
ALTER TABLE pos.compra ADD CONSTRAINT compra_subtotal_check CHECK ((subtotal >= (0)::numeric));
ALTER TABLE pos.compra ADD CONSTRAINT compra_total_check CHECK ((total >= (0)::numeric));
ALTER TABLE pos.compra_detalle ADD CONSTRAINT compra_detalle_cantidad_check CHECK ((cantidad > (0)::numeric));
ALTER TABLE pos.compra_detalle ADD CONSTRAINT compra_detalle_descuento_porcentaje_check CHECK (((descuento_porcentaje >= (0)::numeric) AND (descuento_porcentaje <= (100)::numeric)));
ALTER TABLE pos.compra_detalle ADD CONSTRAINT compra_detalle_precio_unitario_check CHECK ((precio_unitario >= (0)::numeric));
ALTER TABLE pos.compra_detalle ADD CONSTRAINT compra_detalle_tasa_impuesto_check CHECK (((tasa_impuesto >= (0)::numeric) AND (tasa_impuesto <= (100)::numeric)));
ALTER TABLE pos.compra_pago ADD CONSTRAINT compra_pago_monto_check CHECK ((monto > (0)::numeric));
ALTER TABLE pos.cotizacion ADD CONSTRAINT cotizacion_descuento_check CHECK ((descuento >= (0)::numeric));
ALTER TABLE pos.cotizacion ADD CONSTRAINT cotizacion_estado_check CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'ENVIADA'::character varying, 'ACEPTADA'::character varying, 'RECHAZADA'::character varying, 'VENCIDA'::character varying, 'CONVERTIDA'::character varying, 'CANCELADA'::character varying])::text[])));
ALTER TABLE pos.cotizacion ADD CONSTRAINT cotizacion_impuesto_check CHECK ((impuesto >= (0)::numeric));
ALTER TABLE pos.cotizacion ADD CONSTRAINT cotizacion_subtotal_check CHECK ((subtotal >= (0)::numeric));
ALTER TABLE pos.cotizacion ADD CONSTRAINT cotizacion_total_check CHECK ((total >= (0)::numeric));
ALTER TABLE pos.cotizacion_detalle ADD CONSTRAINT cotizacion_detalle_cantidad_check CHECK ((cantidad > (0)::numeric));
ALTER TABLE pos.cotizacion_detalle ADD CONSTRAINT cotizacion_detalle_descuento_porcentaje_check CHECK (((descuento_porcentaje >= (0)::numeric) AND (descuento_porcentaje <= (100)::numeric)));
ALTER TABLE pos.cotizacion_detalle ADD CONSTRAINT cotizacion_detalle_precio_unitario_check CHECK ((precio_unitario >= (0)::numeric));
ALTER TABLE pos.cotizacion_detalle ADD CONSTRAINT cotizacion_detalle_tasa_impuesto_check CHECK (((tasa_impuesto >= (0)::numeric) AND (tasa_impuesto <= (100)::numeric)));
ALTER TABLE pos.existencia ADD CONSTRAINT ck_existencia_reservado CHECK ((reservado <= cantidad));
ALTER TABLE pos.existencia ADD CONSTRAINT existencia_cantidad_check CHECK ((cantidad >= (0)::numeric));
ALTER TABLE pos.existencia ADD CONSTRAINT existencia_costo_promedio_check CHECK ((costo_promedio >= (0)::numeric));
ALTER TABLE pos.existencia ADD CONSTRAINT existencia_reservado_check CHECK ((reservado >= (0)::numeric));
ALTER TABLE pos.impuesto ADD CONSTRAINT impuesto_tasa_check CHECK (((tasa >= (0)::numeric) AND (tasa <= (100)::numeric)));
ALTER TABLE pos.movimiento_caja ADD CONSTRAINT movimiento_caja_monto_check CHECK ((monto > (0)::numeric));
ALTER TABLE pos.movimiento_caja ADD CONSTRAINT movimiento_caja_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['ENTRADA'::character varying, 'SALIDA'::character varying])::text[])));
ALTER TABLE pos.movimiento_inventario ADD CONSTRAINT movimiento_inventario_cantidad_check CHECK ((cantidad > (0)::numeric));
ALTER TABLE pos.movimiento_inventario ADD CONSTRAINT movimiento_inventario_costo_unitario_check CHECK (((costo_unitario IS NULL) OR (costo_unitario >= (0)::numeric)));
ALTER TABLE pos.movimiento_inventario ADD CONSTRAINT movimiento_inventario_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['ENTRADA'::character varying, 'SALIDA'::character varying, 'AJUSTE_POSITIVO'::character varying, 'AJUSTE_NEGATIVO'::character varying, 'TRANSFERENCIA_ENTRADA'::character varying, 'TRANSFERENCIA_SALIDA'::character varying])::text[])));
ALTER TABLE pos.orden_venta ADD CONSTRAINT orden_venta_descuento_check CHECK ((descuento >= (0)::numeric));
ALTER TABLE pos.orden_venta ADD CONSTRAINT orden_venta_estado_check CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'EN_PROCESO'::character varying, 'LISTA'::character varying, 'FACTURADA'::character varying, 'CANCELADA'::character varying])::text[])));
ALTER TABLE pos.orden_venta ADD CONSTRAINT orden_venta_impuesto_check CHECK ((impuesto >= (0)::numeric));
ALTER TABLE pos.orden_venta ADD CONSTRAINT orden_venta_subtotal_check CHECK ((subtotal >= (0)::numeric));
ALTER TABLE pos.orden_venta ADD CONSTRAINT orden_venta_total_check CHECK ((total >= (0)::numeric));
ALTER TABLE pos.orden_venta_detalle ADD CONSTRAINT orden_venta_detalle_cantidad_check CHECK ((cantidad > (0)::numeric));
ALTER TABLE pos.orden_venta_detalle ADD CONSTRAINT orden_venta_detalle_descuento_porcentaje_check CHECK (((descuento_porcentaje >= (0)::numeric) AND (descuento_porcentaje <= (100)::numeric)));
ALTER TABLE pos.orden_venta_detalle ADD CONSTRAINT orden_venta_detalle_precio_unitario_check CHECK ((precio_unitario >= (0)::numeric));
ALTER TABLE pos.orden_venta_detalle ADD CONSTRAINT orden_venta_detalle_tasa_impuesto_check CHECK (((tasa_impuesto >= (0)::numeric) AND (tasa_impuesto <= (100)::numeric)));
ALTER TABLE pos.pedido_cliente ADD CONSTRAINT pedido_cliente_descuento_check CHECK ((descuento >= (0)::numeric));
ALTER TABLE pos.pedido_cliente ADD CONSTRAINT pedido_cliente_estado_check CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'CONFIRMADO'::character varying, 'EN_PREPARACION'::character varying, 'LISTO'::character varying, 'ENTREGADO'::character varying, 'FACTURADO'::character varying, 'CANCELADO'::character varying])::text[])));
ALTER TABLE pos.pedido_cliente ADD CONSTRAINT pedido_cliente_impuesto_check CHECK ((impuesto >= (0)::numeric));
ALTER TABLE pos.pedido_cliente ADD CONSTRAINT pedido_cliente_subtotal_check CHECK ((subtotal >= (0)::numeric));
ALTER TABLE pos.pedido_cliente ADD CONSTRAINT pedido_cliente_total_check CHECK ((total >= (0)::numeric));
ALTER TABLE pos.pedido_cliente_detalle ADD CONSTRAINT pedido_cliente_detalle_cantidad_check CHECK ((cantidad > (0)::numeric));
ALTER TABLE pos.pedido_cliente_detalle ADD CONSTRAINT pedido_cliente_detalle_descuento_porcentaje_check CHECK (((descuento_porcentaje >= (0)::numeric) AND (descuento_porcentaje <= (100)::numeric)));
ALTER TABLE pos.pedido_cliente_detalle ADD CONSTRAINT pedido_cliente_detalle_precio_unitario_check CHECK ((precio_unitario >= (0)::numeric));
ALTER TABLE pos.pedido_cliente_detalle ADD CONSTRAINT pedido_cliente_detalle_tasa_impuesto_check CHECK (((tasa_impuesto >= (0)::numeric) AND (tasa_impuesto <= (100)::numeric)));
ALTER TABLE pos.producto ADD CONSTRAINT ck_producto_servicio_inventario CHECK ((((tipo)::text = 'PRODUCTO'::text) OR (controla_inventario = false)));
ALTER TABLE pos.producto ADD CONSTRAINT producto_costo_referencia_check CHECK ((costo_referencia >= (0)::numeric));
ALTER TABLE pos.producto ADD CONSTRAINT producto_precio_venta_check CHECK ((precio_venta >= (0)::numeric));
ALTER TABLE pos.producto ADD CONSTRAINT producto_stock_maximo_check CHECK (((stock_maximo IS NULL) OR (stock_maximo >= (0)::numeric)));
ALTER TABLE pos.producto ADD CONSTRAINT producto_stock_minimo_check CHECK ((stock_minimo >= (0)::numeric));
ALTER TABLE pos.producto ADD CONSTRAINT producto_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['PRODUCTO'::character varying, 'SERVICIO'::character varying])::text[])));
ALTER TABLE pos.proveedor ADD CONSTRAINT proveedor_dias_credito_check CHECK ((dias_credito >= 0));
ALTER TABLE pos.proveedor_direccion ADD CONSTRAINT proveedor_direccion_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['FISCAL'::character varying, 'ENTREGA'::character varying, 'OTRA'::character varying])::text[])));
ALTER TABLE pos.sesion_caja ADD CONSTRAINT sesion_caja_estado_check CHECK (((estado)::text = ANY ((ARRAY['ABIERTA'::character varying, 'CERRADA'::character varying])::text[])));
ALTER TABLE pos.sesion_caja ADD CONSTRAINT sesion_caja_monto_apertura_check CHECK ((monto_apertura >= (0)::numeric));
ALTER TABLE pos.transferencia_almacen ADD CONSTRAINT ck_transferencia_almacenes_diferentes CHECK ((almacen_origen_id <> almacen_destino_id));
ALTER TABLE pos.transferencia_almacen ADD CONSTRAINT transferencia_almacen_estado_check CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'COMPLETADA'::character varying, 'CANCELADA'::character varying])::text[])));
ALTER TABLE pos.transferencia_detalle ADD CONSTRAINT transferencia_detalle_cantidad_check CHECK ((cantidad > (0)::numeric));
ALTER TABLE pos.usuario ADD CONSTRAINT usuario_intentos_fallidos_check CHECK ((intentos_fallidos >= 0));
ALTER TABLE pos.venta ADD CONSTRAINT ck_venta_un_solo_origen CHECK ((num_nonnulls(cotizacion_id, orden_venta_id, pedido_cliente_id) <= 1));
ALTER TABLE pos.venta ADD CONSTRAINT venta_condicion_pago_check CHECK (((condicion_pago)::text = ANY ((ARRAY['CONTADO'::character varying, 'CREDITO'::character varying])::text[])));
ALTER TABLE pos.venta ADD CONSTRAINT venta_descuento_check CHECK ((descuento >= (0)::numeric));
ALTER TABLE pos.venta ADD CONSTRAINT venta_estado_check CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'COMPLETADA'::character varying, 'CANCELADA'::character varying])::text[])));
ALTER TABLE pos.venta ADD CONSTRAINT venta_impuesto_check CHECK ((impuesto >= (0)::numeric));
ALTER TABLE pos.venta ADD CONSTRAINT venta_subtotal_check CHECK ((subtotal >= (0)::numeric));
ALTER TABLE pos.venta ADD CONSTRAINT venta_total_check CHECK ((total >= (0)::numeric));
ALTER TABLE pos.venta_detalle ADD CONSTRAINT venta_detalle_cantidad_check CHECK ((cantidad > (0)::numeric));
ALTER TABLE pos.venta_detalle ADD CONSTRAINT venta_detalle_costo_unitario_check CHECK (((costo_unitario IS NULL) OR (costo_unitario >= (0)::numeric)));
ALTER TABLE pos.venta_detalle ADD CONSTRAINT venta_detalle_descuento_porcentaje_check CHECK (((descuento_porcentaje >= (0)::numeric) AND (descuento_porcentaje <= (100)::numeric)));
ALTER TABLE pos.venta_detalle ADD CONSTRAINT venta_detalle_precio_unitario_check CHECK ((precio_unitario >= (0)::numeric));
ALTER TABLE pos.venta_detalle ADD CONSTRAINT venta_detalle_tasa_impuesto_check CHECK (((tasa_impuesto >= (0)::numeric) AND (tasa_impuesto <= (100)::numeric)));
ALTER TABLE pos.venta_pago ADD CONSTRAINT venta_pago_monto_check CHECK ((monto > (0)::numeric));
