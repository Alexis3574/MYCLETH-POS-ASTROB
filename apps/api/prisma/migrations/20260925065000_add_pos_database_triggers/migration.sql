-- Existing PostgreSQL trigger functions

-- Function: fn_actualizar_timestamp
CREATE OR REPLACE FUNCTION pos.fn_actualizar_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.actualizado_en := NOW();
    RETURN NEW;
END;
$function$;

-- Function: fn_aplicar_movimiento_inventario
CREATE OR REPLACE FUNCTION pos.fn_aplicar_movimiento_inventario()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_delta NUMERIC(14,3);
BEGIN
    v_delta := CASE
        WHEN NEW.tipo IN ('ENTRADA', 'AJUSTE_POSITIVO', 'TRANSFERENCIA_ENTRADA')
            THEN NEW.cantidad
        ELSE -NEW.cantidad
    END;

    IF v_delta > 0 THEN
        -- Entradas: crea la existencia si todavÃ­a no existe y recalcula costo promedio.
        INSERT INTO pos.existencia (
            producto_id,
            almacen_id,
            cantidad,
            reservado,
            costo_promedio,
            actualizado_en
        )
        VALUES (
            NEW.producto_id,
            NEW.almacen_id,
            v_delta,
            0,
            COALESCE(NEW.costo_unitario, 0),
            NOW()
        )
        ON CONFLICT (producto_id, almacen_id)
        DO UPDATE SET
            costo_promedio = CASE
                WHEN NEW.costo_unitario IS NOT NULL
                     AND (pos.existencia.cantidad + v_delta) > 0
                THEN ROUND(
                    (
                        (pos.existencia.cantidad * pos.existencia.costo_promedio)
                        + (v_delta * NEW.costo_unitario)
                    ) / (pos.existencia.cantidad + v_delta),
                    4
                )
                ELSE pos.existencia.costo_promedio
            END,
            cantidad = pos.existencia.cantidad + v_delta,
            actualizado_en = NOW();
    ELSE
        -- Salidas: actualizaciÃ³n atÃ³mica. Evita vender/transferir mÃ¡s de lo disponible.
        UPDATE pos.existencia
        SET cantidad = cantidad + v_delta,
            actualizado_en = NOW()
        WHERE producto_id = NEW.producto_id
          AND almacen_id = NEW.almacen_id
          AND (cantidad + v_delta) >= reservado;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Existencia insuficiente para producto % en almacÃ©n %. Cantidad solicitada: %',
                NEW.producto_id, NEW.almacen_id, ABS(v_delta);
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- Function: fn_calcular_importes_detalle
CREATE OR REPLACE FUNCTION pos.fn_calcular_importes_detalle()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_base NUMERIC(14,2);
BEGIN
    NEW.subtotal_linea := ROUND((NEW.cantidad * NEW.precio_unitario)::numeric, 2);
    NEW.descuento_importe := ROUND((NEW.subtotal_linea * NEW.descuento_porcentaje / 100)::numeric, 2);
    v_base := NEW.subtotal_linea - NEW.descuento_importe;
    NEW.impuesto_importe := ROUND((v_base * NEW.tasa_impuesto / 100)::numeric, 2);
    NEW.total_linea := v_base + NEW.impuesto_importe;
    RETURN NEW;
END;
$function$;

-- Function: fn_recalcular_totales_documento
CREATE OR REPLACE FUNCTION pos.fn_recalcular_totales_documento()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_fk_columna TEXT := TG_ARGV[0];
    v_tabla_encabezado TEXT := TG_ARGV[1];
    v_id_nuevo BIGINT;
    v_id_anterior BIGINT;
    v_id BIGINT;
BEGIN
    IF TG_OP <> 'DELETE' THEN
        v_id_nuevo := (to_jsonb(NEW) ->> v_fk_columna)::BIGINT;
    END IF;

    IF TG_OP <> 'INSERT' THEN
        v_id_anterior := (to_jsonb(OLD) ->> v_fk_columna)::BIGINT;
    END IF;

    FOR v_id IN
        SELECT DISTINCT x
        FROM unnest(ARRAY[v_id_nuevo, v_id_anterior]) AS t(x)
        WHERE x IS NOT NULL
    LOOP
        EXECUTE format(
            'UPDATE pos.%I h
             SET subtotal = x.subtotal,
                 descuento = x.descuento,
                 impuesto = x.impuesto,
                 total = x.total
             FROM (
                 SELECT
                     COALESCE(SUM(subtotal_linea), 0)::numeric(14,2) AS subtotal,
                     COALESCE(SUM(descuento_importe), 0)::numeric(14,2) AS descuento,
                     COALESCE(SUM(impuesto_importe), 0)::numeric(14,2) AS impuesto,
                     COALESCE(SUM(total_linea), 0)::numeric(14,2) AS total
                 FROM pos.%I
                 WHERE %I = $1
             ) x
             WHERE h.id = $1',
            v_tabla_encabezado,
            TG_TABLE_NAME,
            v_fk_columna
        ) USING v_id;
    END LOOP;

    RETURN NULL;
END;
$function$;

-- Function: fn_validar_documento_editable
CREATE OR REPLACE FUNCTION pos.fn_validar_documento_editable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_fk_columna TEXT := TG_ARGV[0];
    v_tabla_encabezado TEXT := TG_ARGV[1];
    v_estado_editable TEXT := TG_ARGV[2];
    v_documento_id BIGINT;
    v_estado TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_documento_id := (to_jsonb(OLD) ->> v_fk_columna)::BIGINT;
    ELSE
        v_documento_id := (to_jsonb(NEW) ->> v_fk_columna)::BIGINT;
    END IF;

    EXECUTE format('SELECT estado FROM pos.%I WHERE id = $1', v_tabla_encabezado)
    INTO v_estado
    USING v_documento_id;

    IF v_estado IS DISTINCT FROM v_estado_editable THEN
        RAISE EXCEPTION 'El documento % con id % no es editable. Estado actual: %',
            v_tabla_encabezado, v_documento_id, v_estado;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;

-- Existing PostgreSQL triggers

DROP TRIGGER IF EXISTS "trg_almacen_actualizado" ON "pos"."almacen";
CREATE TRIGGER trg_almacen_actualizado BEFORE UPDATE ON pos.almacen FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_caja_actualizado" ON "pos"."caja";
CREATE TRIGGER trg_caja_actualizado BEFORE UPDATE ON pos.caja FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_categoria_actualizado" ON "pos"."categoria";
CREATE TRIGGER trg_categoria_actualizado BEFORE UPDATE ON pos.categoria FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_cliente_actualizado" ON "pos"."cliente";
CREATE TRIGGER trg_cliente_actualizado BEFORE UPDATE ON pos.cliente FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_compra_actualizado" ON "pos"."compra";
CREATE TRIGGER trg_compra_actualizado BEFORE UPDATE ON pos.compra FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_compra_detalle_editable" ON "pos"."compra_detalle";
CREATE TRIGGER trg_compra_detalle_editable BEFORE INSERT OR DELETE OR UPDATE ON pos.compra_detalle FOR EACH ROW EXECUTE FUNCTION pos.fn_validar_documento_editable('compra_id', 'compra', 'BORRADOR');

DROP TRIGGER IF EXISTS "trg_compra_detalle_importes" ON "pos"."compra_detalle";
CREATE TRIGGER trg_compra_detalle_importes BEFORE INSERT OR UPDATE OF cantidad, precio_unitario, descuento_porcentaje, tasa_impuesto ON pos.compra_detalle FOR EACH ROW EXECUTE FUNCTION pos.fn_calcular_importes_detalle();

DROP TRIGGER IF EXISTS "trg_compra_totales" ON "pos"."compra_detalle";
CREATE TRIGGER trg_compra_totales AFTER INSERT OR DELETE OR UPDATE ON pos.compra_detalle FOR EACH ROW EXECUTE FUNCTION pos.fn_recalcular_totales_documento('compra_id', 'compra');

DROP TRIGGER IF EXISTS "trg_configuracion_actualizado" ON "pos"."configuracion_empresa";
CREATE TRIGGER trg_configuracion_actualizado BEFORE UPDATE ON pos.configuracion_empresa FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_cotizacion_actualizado" ON "pos"."cotizacion";
CREATE TRIGGER trg_cotizacion_actualizado BEFORE UPDATE ON pos.cotizacion FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_cotizacion_detalle_importes" ON "pos"."cotizacion_detalle";
CREATE TRIGGER trg_cotizacion_detalle_importes BEFORE INSERT OR UPDATE OF cantidad, precio_unitario, descuento_porcentaje, tasa_impuesto ON pos.cotizacion_detalle FOR EACH ROW EXECUTE FUNCTION pos.fn_calcular_importes_detalle();

DROP TRIGGER IF EXISTS "trg_cotizacion_totales" ON "pos"."cotizacion_detalle";
CREATE TRIGGER trg_cotizacion_totales AFTER INSERT OR DELETE OR UPDATE ON pos.cotizacion_detalle FOR EACH ROW EXECUTE FUNCTION pos.fn_recalcular_totales_documento('cotizacion_id', 'cotizacion');

DROP TRIGGER IF EXISTS "trg_empresa_actualizado" ON "pos"."empresa";
CREATE TRIGGER trg_empresa_actualizado BEFORE UPDATE ON pos.empresa FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_existencia_actualizado" ON "pos"."existencia";
CREATE TRIGGER trg_existencia_actualizado BEFORE UPDATE ON pos.existencia FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_impuesto_actualizado" ON "pos"."impuesto";
CREATE TRIGGER trg_impuesto_actualizado BEFORE UPDATE ON pos.impuesto FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_movimiento_inventario_aplicar" ON "pos"."movimiento_inventario";
CREATE TRIGGER trg_movimiento_inventario_aplicar AFTER INSERT ON pos.movimiento_inventario FOR EACH ROW EXECUTE FUNCTION pos.fn_aplicar_movimiento_inventario();

DROP TRIGGER IF EXISTS "trg_orden_venta_actualizado" ON "pos"."orden_venta";
CREATE TRIGGER trg_orden_venta_actualizado BEFORE UPDATE ON pos.orden_venta FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_orden_venta_detalle_importes" ON "pos"."orden_venta_detalle";
CREATE TRIGGER trg_orden_venta_detalle_importes BEFORE INSERT OR UPDATE OF cantidad, precio_unitario, descuento_porcentaje, tasa_impuesto ON pos.orden_venta_detalle FOR EACH ROW EXECUTE FUNCTION pos.fn_calcular_importes_detalle();

DROP TRIGGER IF EXISTS "trg_orden_venta_totales" ON "pos"."orden_venta_detalle";
CREATE TRIGGER trg_orden_venta_totales AFTER INSERT OR DELETE OR UPDATE ON pos.orden_venta_detalle FOR EACH ROW EXECUTE FUNCTION pos.fn_recalcular_totales_documento('orden_venta_id', 'orden_venta');

DROP TRIGGER IF EXISTS "trg_pedido_cliente_actualizado" ON "pos"."pedido_cliente";
CREATE TRIGGER trg_pedido_cliente_actualizado BEFORE UPDATE ON pos.pedido_cliente FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_pedido_cliente_detalle_importes" ON "pos"."pedido_cliente_detalle";
CREATE TRIGGER trg_pedido_cliente_detalle_importes BEFORE INSERT OR UPDATE OF cantidad, precio_unitario, descuento_porcentaje, tasa_impuesto ON pos.pedido_cliente_detalle FOR EACH ROW EXECUTE FUNCTION pos.fn_calcular_importes_detalle();

DROP TRIGGER IF EXISTS "trg_pedido_cliente_totales" ON "pos"."pedido_cliente_detalle";
CREATE TRIGGER trg_pedido_cliente_totales AFTER INSERT OR DELETE OR UPDATE ON pos.pedido_cliente_detalle FOR EACH ROW EXECUTE FUNCTION pos.fn_recalcular_totales_documento('pedido_cliente_id', 'pedido_cliente');

DROP TRIGGER IF EXISTS "trg_producto_actualizado" ON "pos"."producto";
CREATE TRIGGER trg_producto_actualizado BEFORE UPDATE ON pos.producto FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_proveedor_actualizado" ON "pos"."proveedor";
CREATE TRIGGER trg_proveedor_actualizado BEFORE UPDATE ON pos.proveedor FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_sesion_caja_actualizado" ON "pos"."sesion_caja";
CREATE TRIGGER trg_sesion_caja_actualizado BEFORE UPDATE ON pos.sesion_caja FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_sucursal_actualizado" ON "pos"."sucursal";
CREATE TRIGGER trg_sucursal_actualizado BEFORE UPDATE ON pos.sucursal FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_transferencia_actualizado" ON "pos"."transferencia_almacen";
CREATE TRIGGER trg_transferencia_actualizado BEFORE UPDATE ON pos.transferencia_almacen FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_usuario_actualizado" ON "pos"."usuario";
CREATE TRIGGER trg_usuario_actualizado BEFORE UPDATE ON pos.usuario FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_venta_actualizado" ON "pos"."venta";
CREATE TRIGGER trg_venta_actualizado BEFORE UPDATE ON pos.venta FOR EACH ROW EXECUTE FUNCTION pos.fn_actualizar_timestamp();

DROP TRIGGER IF EXISTS "trg_venta_detalle_editable" ON "pos"."venta_detalle";
CREATE TRIGGER trg_venta_detalle_editable BEFORE INSERT OR DELETE OR UPDATE ON pos.venta_detalle FOR EACH ROW EXECUTE FUNCTION pos.fn_validar_documento_editable('venta_id', 'venta', 'BORRADOR');

DROP TRIGGER IF EXISTS "trg_venta_detalle_importes" ON "pos"."venta_detalle";
CREATE TRIGGER trg_venta_detalle_importes BEFORE INSERT OR UPDATE OF cantidad, precio_unitario, descuento_porcentaje, tasa_impuesto ON pos.venta_detalle FOR EACH ROW EXECUTE FUNCTION pos.fn_calcular_importes_detalle();

DROP TRIGGER IF EXISTS "trg_venta_totales" ON "pos"."venta_detalle";
CREATE TRIGGER trg_venta_totales AFTER INSERT OR DELETE OR UPDATE ON pos.venta_detalle FOR EACH ROW EXECUTE FUNCTION pos.fn_recalcular_totales_documento('venta_id', 'venta');
