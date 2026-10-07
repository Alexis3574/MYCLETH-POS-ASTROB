BEGIN;

CREATE TABLE pos.operacion_transferencia (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES pos.empresa(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  transferencia_id BIGINT NOT NULL REFERENCES pos.transferencia_almacen(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  usuario_id BIGINT NOT NULL REFERENCES pos.usuario(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  clave_idempotencia UUID NOT NULL,
  accion VARCHAR(20) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  respuesta JSONB NOT NULL,
  creado_en TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_operacion_transferencia_empresa_clave UNIQUE (empresa_id, clave_idempotencia),
  CONSTRAINT ck_operacion_transferencia_accion CHECK (accion IN ('CREAR', 'COMPLETAR', 'CANCELAR')),
  CONSTRAINT ck_operacion_transferencia_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_operacion_transferencia_respuesta CHECK (jsonb_typeof(respuesta) = 'object')
);

CREATE INDEX idx_operacion_transferencia_documento_fecha
ON pos.operacion_transferencia(transferencia_id, creado_en DESC);
CREATE INDEX idx_operacion_transferencia_empresa_fecha
ON pos.operacion_transferencia(empresa_id, creado_en DESC);
CREATE INDEX idx_transferencia_empresa_estado_fecha
ON pos.transferencia_almacen(empresa_id, estado, fecha DESC, id DESC);

CREATE OR REPLACE FUNCTION pos.fn_transferencia_detalle_editable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pos AS $function$
DECLARE
  v_id BIGINT;
  v_estado TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.transferencia_id IS DISTINCT FROM OLD.transferencia_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_DETAIL_IMMUTABLE';
  END IF;
  IF TG_OP = 'DELETE' THEN v_id := OLD.transferencia_id;
  ELSE v_id := NEW.transferencia_id;
  END IF;
  SELECT estado INTO v_estado FROM pos.transferencia_almacen WHERE id = v_id FOR UPDATE;
  IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF v_estado IS DISTINCT FROM 'BORRADOR' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_DETAIL_IMMUTABLE';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_transferencia_detalle_editable
BEFORE INSERT OR UPDATE OR DELETE ON pos.transferencia_detalle
FOR EACH ROW EXECUTE FUNCTION pos.fn_transferencia_detalle_editable();

CREATE OR REPLACE PROCEDURE pos.sp_completar_transferencia(IN p_transferencia_id BIGINT, IN p_usuario_id BIGINT)
LANGUAGE plpgsql SET search_path = pg_catalog, pos AS $procedure$
DECLARE
  v_empresa BIGINT;
  v_trans pos.transferencia_almacen%ROWTYPE;
  v_det RECORD;
  v_origen pos.existencia%ROWTYPE;
  v_destino pos.existencia%ROWTYPE;
  v_id BIGINT;
  v_cuenta INTEGER;
BEGIN
  SELECT u.empresa_id INTO v_empresa FROM pos.usuario u JOIN pos.empresa e ON e.id = u.empresa_id
  WHERE u.id = p_usuario_id AND u.activo AND NOT u.bloqueado AND e.activo FOR SHARE OF u, e;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_ACTOR_INACTIVE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pos.usuario_rol ur JOIN pos.rol r ON r.id = ur.rol_id
    JOIN pos.rol_permiso rp ON rp.rol_id = r.id JOIN pos.permiso p ON p.id = rp.permiso_id
    WHERE ur.usuario_id = p_usuario_id AND r.activo AND p.codigo = 'INVENTARIO.TRANSFERIR'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_PERMISSION_REQUIRED';
  END IF;

  SELECT * INTO v_trans FROM pos.transferencia_almacen
  WHERE id = p_transferencia_id AND empresa_id = v_empresa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_NOT_FOUND'; END IF;
  IF v_trans.estado <> 'BORRADOR' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_INVALID_STATE';
  END IF;
  IF v_trans.almacen_origen_id = v_trans.almacen_destino_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_WAREHOUSE_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pos.usuario WHERE id = v_trans.usuario_id AND empresa_id = v_empresa) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_NOT_FOUND';
  END IF;

  v_cuenta := 0;
  FOR v_id IN
    SELECT a.id FROM pos.almacen a JOIN pos.sucursal s ON s.id = a.sucursal_id
    WHERE a.id IN (v_trans.almacen_origen_id, v_trans.almacen_destino_id)
      AND s.empresa_id = v_empresa ORDER BY a.id FOR SHARE OF a, s
  LOOP
    v_cuenta := v_cuenta + 1;
    IF NOT EXISTS (SELECT 1 FROM pos.almacen a JOIN pos.sucursal s ON s.id = a.sucursal_id
      WHERE a.id = v_id AND a.activo AND s.activo AND s.empresa_id = v_empresa) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_WAREHOUSE_INVALID';
    END IF;
  END LOOP;
  IF v_cuenta <> 2 THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_WAREHOUSE_INVALID'; END IF;

  SELECT COUNT(*) INTO v_cuenta FROM pos.transferencia_detalle WHERE transferencia_id = p_transferencia_id;
  IF v_cuenta = 0 THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_EMPTY'; END IF;
  IF EXISTS (SELECT 1 FROM pos.movimiento_inventario WHERE documento_tipo = 'TRANSFERENCIA' AND documento_id = p_transferencia_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_MOVEMENTS_EXIST';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'pos.movimiento_inventario'::regclass AND NOT t.tgisinternal
      AND t.tgname = 'trg_movimiento_inventario_aplicar' AND t.tgtype = 5
      AND t.tgfoid = 'pos.fn_aplicar_movimiento_inventario()'::regprocedure
      AND (t.tgenabled = 'A' OR (t.tgenabled = 'O' AND current_setting('session_replication_role') <> 'replica'))
  ) THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_TRIGGER_INVALID'; END IF;

  FOR v_det IN SELECT producto_id FROM pos.transferencia_detalle
    WHERE transferencia_id = p_transferencia_id ORDER BY producto_id
  LOOP
    PERFORM p.id FROM pos.producto p JOIN pos.unidad_medida u ON u.id = p.unidad_medida_id
    WHERE p.id = v_det.producto_id AND p.empresa_id = v_empresa FOR NO KEY UPDATE OF p FOR SHARE OF u;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_PRODUCT_INVALID'; END IF;
  END LOOP;

  FOR v_det IN
    SELECT td.*, p.empresa_id, p.activo AS producto_activo, p.tipo AS producto_tipo, p.controla_inventario,
      u.activo AS unidad_activa, u.permite_decimales
    FROM pos.transferencia_detalle td JOIN pos.producto p ON p.id = td.producto_id
    JOIN pos.unidad_medida u ON u.id = p.unidad_medida_id
    WHERE td.transferencia_id = p_transferencia_id ORDER BY td.producto_id
  LOOP
    IF v_det.empresa_id <> v_empresa OR NOT v_det.producto_activo OR v_det.producto_tipo <> 'PRODUCTO'
      OR NOT v_det.controla_inventario OR NOT v_det.unidad_activa OR v_det.cantidad <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_PRODUCT_INVALID';
    END IF;
    IF NOT v_det.permite_decimales AND v_det.cantidad <> trunc(v_det.cantidad) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_UNIT_REQUIRES_INTEGER';
    END IF;
    INSERT INTO pos.existencia(producto_id, almacen_id, cantidad, reservado, costo_promedio)
    VALUES (v_det.producto_id, v_trans.almacen_destino_id, 0, 0, 0)
    ON CONFLICT (producto_id, almacen_id) DO NOTHING;
    PERFORM e.producto_id FROM pos.existencia e
    WHERE e.producto_id = v_det.producto_id AND e.almacen_id IN (v_trans.almacen_origen_id, v_trans.almacen_destino_id)
    ORDER BY e.producto_id, e.almacen_id FOR UPDATE;
    SELECT * INTO v_origen FROM pos.existencia WHERE producto_id = v_det.producto_id AND almacen_id = v_trans.almacen_origen_id;
    IF NOT FOUND OR v_origen.disponible IS NULL OR v_origen.disponible < v_det.cantidad THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_INSUFFICIENT_AVAILABLE';
    END IF;
    SELECT * INTO v_destino FROM pos.existencia WHERE producto_id = v_det.producto_id AND almacen_id = v_trans.almacen_destino_id;
    IF v_destino.cantidad + v_det.cantidad > 99999999999.999 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_STOCK_LIMIT';
    END IF;
    IF v_origen.costo_promedio < 0 OR v_destino.costo_promedio < 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSFER_COST_INVALID';
    END IF;

    INSERT INTO pos.movimiento_inventario(producto_id, almacen_id, usuario_id, tipo, cantidad,
      costo_unitario, documento_tipo, documento_id, documento_detalle_id, motivo)
    VALUES (v_det.producto_id, v_trans.almacen_origen_id, p_usuario_id, 'TRANSFERENCIA_SALIDA', v_det.cantidad,
      v_origen.costo_promedio, 'TRANSFERENCIA', p_transferencia_id, v_det.id, 'Salida por transferencia entre almacenes');
    INSERT INTO pos.movimiento_inventario(producto_id, almacen_id, usuario_id, tipo, cantidad,
      costo_unitario, documento_tipo, documento_id, documento_detalle_id, motivo)
    VALUES (v_det.producto_id, v_trans.almacen_destino_id, p_usuario_id, 'TRANSFERENCIA_ENTRADA', v_det.cantidad,
      v_origen.costo_promedio, 'TRANSFERENCIA', p_transferencia_id, v_det.id, 'Entrada por transferencia entre almacenes');
  END LOOP;

  UPDATE pos.transferencia_almacen SET estado = 'COMPLETADA', actualizado_en = CURRENT_TIMESTAMP
  WHERE id = p_transferencia_id AND empresa_id = v_empresa;
END;
$procedure$;

COMMIT;
