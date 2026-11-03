# POSMYCLETH — Validación integral v4

## Objetivo

Cerrar **en una corrida** las cinco brechas de cobertura del reporte v3, sin modificar la implementación de los módulos existentes y sin ocultar limitaciones de despliegue.

**Este paquete entrega código de pruebas; no afirma que se haya ejecutado contra el PostgreSQL local del usuario.** Se requiere v2/v3 ya instalada, rama `devalex`, DB local `pos_novnix`, PostgreSQL puerto 5432 y la suite v3 funcional. No incluye secretos ni `.env`.

## Instalación

Extraer el ZIP en la raíz `POSMYCLETH` con `unzip -n` (no reemplaza módulos ni archivos v3). Los archivos nuevos son:

- `apps/api/scripts/validation/run-v4.mjs`: orquestador y decisión de aceptación.
- `apps/api/tests/integral/v4-safety.mjs`: límites estrictos de base, rama y scripts.
- `apps/api/tests/integral/v4-tenancy-http.mjs`: dos empresas, tres sucursales, usuarios con acceso parcial, permisos y rutas reales JSON/CSV.
- `apps/api/tests/integral/v4-end-to-end.mjs`: una sola cadena de negocio Compra → Recepción → Transferencia → Venta → Devolución, verificación de inventario, outbox, reportes y Dashboard.
- `apps/api/tests/integral/v4-ecommerce-mock.mjs`: mock localhost que cubre PATCH de stock, clave API, payload, idempotencia, HTTP 429/503/502 y timeout.
- `apps/api/tests/integral/v4-load.mjs`: HTTP de lectura con concurrencia configurable, métricas p50/p95/p99, umbrales provisionales y error rate 0.

## Comandos

Desde `apps/api`, con Git Bash, con servidores y workers externos detenidos:

```bash
INVENTORY_SYNC_ENABLED=false node.exe scripts/validation/run-v4.mjs --preflight
```

Después, **solo sobre la base de pruebas `pos_novnix`**:

```bash
POS_INTEGRAL_ALLOW_WRITES=SI \
POS_INTEGRAL_WORKERS_STOPPED=SI \
INVENTORY_SYNC_ENABLED=false \
POS_V4_LOAD_REQUESTS=500 \
POS_V4_LOAD_CONCURRENCY=12 \
POS_V4_LOAD_P95_MS=2000 \
POS_V4_LOAD_P99_MS=4000 \
node.exe scripts/validation/run-v4.mjs --full
```

El mismo comando primero ejecuta la suite v3 completa (espera PASS >= 100 / FAIL=0 / SKIP=5, donde los cinco SKIP corresponden a brechas de cobertura); posteriormente ejecuta los cuatro scripts v4 (dos escenarios de aislamiento se comprueban en el mismo fixture) y compara huellas de **47 tablas** antes y después de cada escenario. Si hay fallos o residuos se interrumpe lo siguiente, pero no se realizan borrados indiscriminados.

## Informes

Se guardan en `apps/api/docs/validation-integral/results/final-v4-<fecha>/`:

- `acceptance.md`: matriz de resultados, limitaciones, estado final.
- `acceptance.json`: evidencia estructurada y decisión.
- `*.log`: salida de cada escenario v3/v4, con redacción básica de URLs de conexión y tokens.

La versión 3 también crea su informe propio en otro directorio `integral-...`.

## Criterios

**ACEPTACION_FUNCIONAL_ENTORNO_PRUEBAS** exige v3 aprobada, los cinco escenarios v4 aprobados, huellas de las tablas restauradas, y 0 pruebas FAIL/SKIP de la ampliación. No es una autorización automática para producción.

**RECHAZADA_O_INCOMPLETA** indica que hay falla, omisión, residuo, carga sobre los umbrales o que el orquestador no llegó al final. Un script con fixture fallido conservará su marcador único en el log para intervención controlada; no hacer `DELETE` general ni reejecutar a ciegas si la huella cambia.

## Límites explícitos

1. **Ecommerce externo:** v4 valida el cliente HTTP con un servidor mock en `127.0.0.1`. No comprueba el Ecommerce real ni staging externo (no se proporcionaron credenciales/URL de staging). Las pruebas v3 sí verifican outbox, reintentos, concurrencia y RBAC en la base de pruebas. Un paso de certificación de despliegue aún debe apuntar a un staging aislado.
2. **Carga:** 500 peticiones/concurrencia 12 y p95/p99 2 s/4 s son **umbrales locales provisionales**, no SLA de producción ni un ensayo de volumen de producción. Definir escenarios, concurrencia, tamaño de base y SLA de negocio antes de certificar producción.
3. **Transacciones:** el E2E es una **secuencia empresarial completa de operaciones reales**; cada módulo conserva su propia transacción. No sería correcto afirmar que varias transacciones distintas son una única transacción atómica global.
4. **Datos temporales:** se usa identificación explícita, transacciones para creación y limpieza, y huellas históricas. PostgreSQL puede incrementar secuencias incluso después de limpiar. Ante interrupción abrupta, pueden quedar fixtures para revisión manual.
5. **Repositorio:** sin backups, migraciones, commits ni push. Los parches v2/v3 continúan como cambios locales que deben revisarse antes de integrarse selectivamente.

## Revisión del informe definitivo

La salida de `acceptance.md`, los logs de los cuatro nuevos escenarios y el `summary.md` de v3 son la evidencia para decidir si el backend puede pasar a **preproducción**. La certificación de **producción** requiere, además, un staging real de Ecommerce, entorno multicliente representativo, datos de volumen esperado, metas SLA reales y revisión operativa de seguridad.
