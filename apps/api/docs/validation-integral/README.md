# POSMYCLETH — Paquete de validación integral v1

## Base analizada

Archivo del usuario: `POSMYCLETH-validacion-integral-20261102-163347.tar.zip`.
`apps/api`, branch `devalex`, commit `f9fca834cb5c6c23db4e8564ae2f9e816af3e49a`.
El paquete analizado NO contiene `.env`, `node_modules`, Prisma generado ni una conexión a PostgreSQL. Por tanto, **no se ejecutaron las pruebas funcionales reales en el equipo del asistente**. Las suites se han seleccionado mediante inspección estática de ese snapshot.

## Instalación

Extraiga el ZIP proporcionado en la **raíz de POSMYCLETH**, no dentro de `apps/api`.
Se crean cuatro archivos nuevos y no se sustituyen archivos actuales.

## Ejecución única — solo lectura/rollback cero

```bash
cd /c/Users/taiga/Documentos/POSMYCLETH/apps/api
node.exe scripts/validation/run-integral.mjs --audit
```

- Comprueba branch `devalex`, host `localhost:5432`, base **`pos_novnix`**, esquema `pos`.
- Ejecuta TypeScript, unidades de múltiples módulos, HTTP/seguridad existentes sin escritura, invariantes SQL y carga HTTP ligera (hasta 60 peticiones, concurrencia 3).
- Compara huellas y conteos de 38 tablas, antes y después, para detectar cambios concurrentes o imprevistos.
- Marca los escenarios sintéticos como **SKIP**, nunca como aprobados.

## Ejecución única — exhaustiva con fixtures

**Requisito operativo obligatorio:** detener previamente todos los servidores POS y procesos worker que consultan/escriben el outbox o se conectan a `pos_novnix`. La variable `INVENTORY_SYNC_ENABLED=false` solo afecta los procesos iniciados por el ejecutor; no detiene los ya existentes. No ejecutar si no puede confirmar el aislamiento.

Después, desde `apps/api`:

```bash
POS_INTEGRAL_ALLOW_WRITES=SI POS_INTEGRAL_WORKERS_STOPPED=SI INVENTORY_SYNC_ENABLED=false \
  node.exe scripts/validation/run-integral.mjs --full
```

`--full` ejecuta primero las pruebas de `--audit`, después realiza preflights de fixtures y, si todo es correcto, pruebas transaccionales con rollback y pruebas sintéticas secuenciales que crean, confirman y posteriormente limpian sus propios datos (Productos CRUD HTTP, Inventario, Compras, Transferencias, Pedidos, Ecommerce outbox). No se realizan llamadas al Ecommerce externo. No se ejecutan migraciones ni se crean respaldos.

**Riesgo residual:** si el proceso se interrumpe bruscamente después de crear fixtures confirmados, la limpieza automática puede no ejecutarse. Por eso el runner se detiene al primer fallo de una prueba de escritura o de una huella de datos. Debe conservarse su registro y **revisarse el marcador específico del fixture antes de intentar limpieza**. Nunca ejecutar limpieza global ni repetir la prueba de escritura en estado inconsistente.

## Resultados

`apps/api/docs/validation-integral/results/integral-<timestamp>-<id>/`

- `summary.json`: matriz automatizada de resultados.
- `summary.md`: informe legible PASS/FAIL/SKIP.
- `NN-*.log`: salidas individuales, redactadas para no mostrar DATABASE_URL ni bearer tokens conocidos. **Revisar manualmente los logs antes de compartir**.

La ausencia de fallos no equivale a certificación de producción. Toda prueba marcada `SKIP` o cobertura no verificada impide declarar el backend completamente validado.

## Cobertura ofrecida y límites

| Área | Pruebas incluidas | Límite |
|---|---|---|
| Productos/Catálogo | validadores, rollback, CRUD HTTP sintético, permisos y empresas distintas | ejecución de fixtures solo en `--full` |
| Inventario | schemas, ajustes +/-, kardex, triggers, outbox, HTTP y concurrencia | `--full` sin worker |
| Transferencias | validaciones, rollback, idempotencia y concurrencia | no usa un endpoint HTTP sin tokens/fixture explícito |
| Compras | unidad y compras reales sintéticas/recepción/outbox | sin compras históricas en DB del snapshot |
| Ventas/Devoluciones | unidades, Dashboard/Reportes histórico, conversiones Pedidos→Venta | pendiente prueba HTTP E2E de devolución en un flujo combinado |
| Ecommerce | unidades, outbox HTTP, reintentos, concurrencia y permisos | no prueba servicio Ecommerce remoto |
| Seguridad | JSON/CSV, JWT, roles, sucursales existentes, integridad relacional | faltan algunos escenarios con usuarios reales multiempresa/multisucursal |
| Rendimiento | carga HTTP liviana y latencias p50/p95/p99 | no prueba throughput máximo o SLA de producción |

**Por qué no se ejecuta indiscriminadamente todo lo incluido en el repositorio:** existen scripts que requieren tokens manuales, servidores externos o conexiones particulares y otros que pueden generar/limpiar registros con riesgos específicos. El ejecutor utiliza una **lista blanca** de pruebas inspeccionadas, no un `find ... | xargs test` indiscriminado.

## Integridad y pendientes

El runner revisa que las relaciones de empresa entre ventas, compras, devoluciones, inventario, transferencias y usuarios/sucursales sean coherentes; verifica existencias disponibles e idempotencia única, y conserva huellas de tablas antes y después. Estas verificaciones detectan anomalías; no corrigen datos.

Los casos pendientes quedan visibles: E2E único Venta+Devolución+Compra+Transferencia; aislamiento multiempresa y multisucursal real con perfiles autorizados parciales; gran volumen/carga y SLAs; API remota Ecommerce controlada. No es correcto declarar esas coberturas aprobadas.

## No realizar

- No ejecutar sobre otra base de datos.
- No arrancar el worker en paralelo ni ejecutar pruebas que consuman eventos del outbox.
- No hacer `git add -A`, `prisma migrate`, limpieza SQL masiva, `git commit` o `git push` como parte de la validación.
- No borrar datos de pruebas existentes sin identificar la propiedad de cada fixture.
