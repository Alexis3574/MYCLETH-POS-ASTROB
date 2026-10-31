# M13 — Sincronización Ecommerce Administrativa

## Objetivo

Supervisar la sincronización de movimientos de inventario con Ecommerce, diagnosticar eventos y autorizar reintentos administrativos sin modificar directamente las existencias.

## Fase 1: supervision y diagnosticos

Endpoints protegidos con JWT y ECOMMERCE_SYNC.VER:

- `GET /api/v1/ecommerce-sync` — listado con filtros y paginacion.
- `GET /api/v1/ecommerce-sync/summary` — resumen de estados.
- `GET /api/v1/ecommerce-sync/diagnostics` — indicadores de diagnostico.
- `GET /api/v1/ecommerce-sync/:id` — detalle de evento.

Seguridad:

- Aislamiento por empresa del usuario.
- Verificacion de empresa del producto y sucursal del movimiento.
- Acceso limitado a sucursales asignadas.
- No exposicion del contenido libre de ultimo_error.
- Validacion estricta de identificadores BIGINT y parametros.

## Fase 2: reintentos y recuperacion

Endpoint administrativo:

- `POST /api/v1/ecommerce-sync/:id/retry`

Requiere JWT y el permiso ECOMMERCE_SYNC.REINTENTAR.

Solo se pueden autorizar eventos AGOTADO visibles para la empresa y sucursal del usuario.

La autorizacion:

- Se realiza mediante transaccion PostgreSQL.
- Protege frente a autorizaciones simultaneas.
- Escribe auditoria dentro de la misma transaccion.
- Conserva operation_id y el historial de intentos.
- Cambia AGOTADO a REINTENTO_MANUAL.

Estados:

- PENDIENTE: evento elegible para procesamiento automatico.
- PROCESANDO: reclamacion automatica activa.
- SINCRONIZADO: sincronizacion finalizada.
- AGOTADO: limite alcanzado o intento manual fallido.
- REINTENTO_MANUAL: autorizacion administrativa pendiente.
- PROCESANDO_MANUAL: reclamacion manual activa.

Flujo automatico:

PENDIENTE -> PROCESANDO -> SINCRONIZADO

Ante errores: PENDIENTE con backoff o AGOTADO si se agotan los intentos.

Flujo manual:

AGOTADO -> REINTENTO_MANUAL -> PROCESANDO_MANUAL

Ante exito: SINCRONIZADO.
Ante fallo o timeout: AGOTADO.

La autorizacion manual permite un procesamiento adicional; no establece un ciclo automatico indefinido.

## Politica de reintentos

Valores predeterminados:

- INVENTORY_SYNC_MAX_ATTEMPTS: 10
- INVENTORY_SYNC_RETRY_BASE_DELAY_MS: 30000
- INVENTORY_SYNC_RETRY_MAX_DELAY_MS: 900000

La seleccion automatica considera el tiempo del ultimo intento y el backoff.

Las reclamaciones usan actualizaciones condicionales y un contador de intentos para evitar escrituras tardias de procesos anteriores.

El operation_id original se conserva para mantener la identidad de la operacion frente a Ecommerce.

## Permisos

- ECOMMERCE_SYNC.VER: consultas y diagnosticos.
- ECOMMERCE_SYNC.REINTENTAR: autorizacion de reintentos manuales.

Scripts de registro:

- scripts/ecommerce-sync/create-permissions.ts
- scripts/ecommerce-sync/create-retry-permission.ts

El registro de permisos no implica asignacion automatica a roles.

## Validaciones ejecutadas

- TypeScript: compilacion aprobada.
- Pruebas unitarias M13: 14/14.
- Concurrencia automatica PostgreSQL: 9/9.
- Reintentos manuales PostgreSQL: 6/6.
- Seguridad HTTP administrativa: 11/11.
- Regresion HTTP de lectura: 15/15.

Las pruebas PostgreSQL emplearon fixtures sinteticos con limpieza y verificacion posterior de integridad.

Se conservaron los 73 eventos historicos del outbox y las 44 auditorias existentes durante las pruebas administrativas.

## Operacion segura

Mantener INVENTORY_SYNC_ENABLED=false hasta autorizar expresamente la activacion operativa.

Antes de habilitar el worker:

- Verificar credenciales y conectividad de Ecommerce.
- Revisar configuracion de reintentos y tiempos de espera.
- Confirmar asignacion de permisos a los roles correctos.
- Validar idempotencia y comportamiento de la integracion externa real.
- Revisar logs, alertas y procedimientos de recuperacion.

Las pruebas locales no sustituyen una validacion extremo a extremo contra Ecommerce.

## Pendientes independientes

- Validaciones funcionales del modulo Productos/Catalogo.
- Validaciones funcionales del modulo Inventario.
- Activacion operativa controlada del worker Ecommerce.
