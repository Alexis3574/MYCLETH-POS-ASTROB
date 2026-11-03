# POSMYCLETH — Corrección integral v3: preflight RO de M11 y M12

## Incidente respaldado en `results.zip`

En la corrida `integral-2026-11-02T22-51-07-113Z-118fa1c0`:

- PASS: 41; FAIL: 1; SKIP: 22.
- El preflight de M11 devolvió `[M11 SAFETY] Base de desarrollo está en modo solo lectura.`
- El orquestador v2 pone `default_transaction_read_only=on` para **todas** las comprobaciones `--preflight` (garantía de solo lectura).
- Los scripts M11, M12 y M12V rechazaban cualquier conexión de solo lectura, aunque `--preflight` no ejecuta escrituras.

## Corrección

Se ajustan **solo tres aserciones de pruebas existentes** para permitir `transaction_read_only=on` únicamente cuando `preflightOnly` es verdadero. Los modos `--run` y `--cleanup-marker` conservan la exigencia `transaction_read_only=off`.

Archivos de pruebas modificados:

- `tests/sales-orders/m11-http-pos-novnix.integration.mjs`
- `tests/customer-orders/m12-http-pos-novnix.integration.mjs`
- `tests/customer-orders/m12-fase2-http-pos-novnix.integration.mjs`

No altera los módulos de negocio, el esquema, el orquestador v2, el historial de auditoría ni PostgreSQL.

## Instalación

Desde la raíz del repositorio:

```bash
unzip -n '/c/Users/taiga/Downloads/POSMYCLETH-suite-integral-parche-v3.zip'
cd apps/api
node.exe scripts/validation/apply-v3.mjs --check
node.exe scripts/validation/apply-v3.mjs --apply
node.exe scripts/validation/apply-v3.mjs --check
```

## Siguiente corrida

Detener **realmente** los servidores, workers y otros procesos que escriben en `pos_novnix` antes de marcar `POS_INTEGRAL_WORKERS_STOPPED=SI`.

```bash
POS_INTEGRAL_ALLOW_WRITES=SI \
POS_INTEGRAL_WORKERS_STOPPED=SI \
INVENTORY_SYNC_ENABLED=false \
node.exe scripts/validation/run-integral.mjs --full
```

No se borran las 50 auditorías existentes ni las configuraciones de M15; son datos históricos y el parche no los modifica.

Las pruebas de escritura crean registros temporales; los scripts intentan limpiarlos, pero una interrupción o fallo inesperado puede dejar datos que requieren inspección de marcadores. No ejecutar comandos de limpieza manual sin revisar los marcadores y las dependencias. Si falla un bloque, la suite omite los siguientes y debe leerse el log correspondiente.

## Limitaciones

La corrección resuelve el **bloqueo estático de preflight** verificado en M11/M12; no garantiza que las pruebas sintéticas posteriores pasen. El informe completo solo debe aprobar el backend una vez terminadas satisfactoriamente las pruebas restantes y la cobertura adicional, incluida la multiempresa/multisucursal, Ecommerce mock y carga productiva.
