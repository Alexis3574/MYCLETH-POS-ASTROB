# POSMYCLETH — Corrección de la suite integral v2

## Incidente localizado

La suite v1 ejecutó `src/modules/company-settings/company-settings.http.integration.mjs` en el bloque **readonly**. Esta prueba contiene un `PUT real: persistencia y auditoría M14` que, cuando encuentra una categoría sin personalizar, inserta una fila en `pos.configuracion_empresa` y una fila en `pos.auditoria`. Las dos ejecuciones publicadas en la conversación detectaron una mutación en `auditoria`; el monitor detectó el efecto, pero la tabla `configuracion_empresa` no estaba incluida en las 38 huellas iniciales.

**No se deben borrar auditorías ni configuraciones automáticamente.** La ejecución v1 puede haber producido entradas legítimas desde el punto de vista SQL que deben revisarse por su procedencia.

## Correcciones v2

1. Reemplaza únicamente en el orquestador la prueba HTTP M15 original por `tests/integral/company-settings-http.readonly.mjs`: solo usa GET, validaciones y respuestas 401/403/400, nunca PUT.
2. Conecta los procesos de lectura con `default_transaction_read_only=on` (DATABASE_URL y aliases de URL de pruebas). De ese modo, cualquier escritura accidental debe fallar en PostgreSQL.
3. Verifica la huella entre pruebas readonly para detectar cuál produjo una alteración.
4. Amplía el snapshot de 38 a **47 modelos del esquema Prisma**; incluye `configuracion_empresa` y las demás tablas omitidas.
5. Reemplaza la condición rígida de 44 auditorías en el preflight del test HTTP de inventario por una condición de igualdad con la **huella tomada antes de ejecutar** la corrida integral, proporcionada por el orquestador. En ejecución aislada del test permanece la condición de 44 auditorías. El outbox histórico sigue exigiendo 73 eventos y todas las comprobaciones de restauración se conservan. Ninguna auditoría es eliminada.
6. Añade un inspector SQL solo lectura para revisar los eventos y configuraciones M15, sin mostrar valores o credenciales.

## Instalación protegida

Extraer este ZIP desde la raíz del repositorio `POSMYCLETH` con `unzip -n`. No sobrescribe el ejecutor por descompresión. Luego ejecutar desde `apps/api`:

```bash
node.exe scripts/validation/apply-v2.mjs
node.exe scripts/validation/inspect-audit-incident.mjs
```

El instalador compara el contenido SHA-256 de las versiones v1 originales **antes de modificar** el orquestador o el test de inventario. Si detecta cambios desconocidos, interrumpe sin sobrescribirlos. No realiza backups, operaciones SQL ni Git.

## Validación

Solo después de comprobar el incidente, confirmar que no hay otros procesos conectados que escriban en `pos_novnix` y que Ecommerce externo está aislado. Comando único:

```bash
POS_INTEGRAL_ALLOW_WRITES=SI POS_INTEGRAL_WORKERS_STOPPED=SI INVENTORY_SYNC_ENABLED=false \
node.exe scripts/validation/run-integral.mjs --full
```

Se repite automáticamente la fase de lectura, integridad y carga antes de proceder a las pruebas transaccionales y de escritura sintética. El ejecutor no modifica la base en `--audit`. **No declarar producción aprobada** si queda alguna prueba SKIP, un escenario sin cobertura o un fallo. No limpiar automáticamente fixtures tras fallos.

## Limitaciones honestas

Esta revisión de sintaxis y parche fue hecha contra el archivo fuente aportado; la conexión de PostgreSQL y las pruebas de integración deben ejecutarse localmente. En `--full` aún pueden encontrarse fallos reales de preflight o de suites de negocio, los cuales deben ser investigados por su evidencia. No sustituye el análisis de la configuración empresarial creada por las primeras dos corridas v1. Las pruebas de SLA, multiempresa completo y el gran flujo E2E combinado siguen pendientes hasta crear escenarios reproducibles.
