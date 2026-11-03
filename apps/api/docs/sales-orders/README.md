# POSMYCLETH — Módulo 11: Órdenes de Venta

## Estado de implementación

Implementación y validaciones funcionales completadas en el
entorno de desarrollo el 30 de octubre de 2026.

- Backend: TypeScript, Express, Prisma y PostgreSQL.
- Rama de desarrollo: devalex.
- Base utilizada: pos_novnix.
- Esquema PostgreSQL: pos.
- Autenticación: JWT.
- Autorización: RBAC.
- Aislamiento: empresa y sucursal.
- Integración: Cotizaciones, Ventas, Inventario, Caja y Ecommerce.

El módulo permite gestionar órdenes, convertir cotizaciones
aceptadas en órdenes y convertir órdenes listas en ventas.

## Endpoints

| Método | Ruta | Permisos |
|---|---|---|
| GET | /api/v1/sales-orders | ORDENES.VER |
| GET | /api/v1/sales-orders/:id | ORDENES.VER |
| POST | /api/v1/sales-orders | ORDENES.CREAR |
| PATCH | /api/v1/sales-orders/:id | ORDENES.CREAR |
| POST | /api/v1/sales-orders/:id/start | ORDENES.CREAR |
| POST | /api/v1/sales-orders/:id/ready | ORDENES.CREAR |
| POST | /api/v1/sales-orders/:id/cancel | ORDENES.CREAR |
| POST | /api/v1/quotes/:id/convert-to-order | COTIZACIONES.CREAR + ORDENES.CREAR |
| POST | /api/v1/sales-orders/:id/convert-to-sale | ORDENES.CREAR + VENTAS.CREAR |

## Ciclo de vida

Estados de orden:
PENDIENTE, EN_PROCESO, LISTA, FACTURADA y CANCELADA.

Transiciones implementadas:
- PENDIENTE -> EN_PROCESO.
- EN_PROCESO -> LISTA.
- PENDIENTE, EN_PROCESO o LISTA -> CANCELADA,
  cuando no existe una venta asociada.
- Una orden CANCELADA no puede convertirse a venta.
- Una orden con venta vinculada no puede cancelarse.
- La conversión a venta exige estado LISTA.

La conversión a venta no cambia automáticamente el estado
a FACTURADA. Su significado fiscal queda sujeto a una
definición de negocio independiente.

## Reglas de integridad

- empresa_id y usuario_id provienen del JWT.
- Los datos recibidos se validan mediante esquemas estrictos.
- Las operaciones verifican empresa y sucursal asignada.
- Los bloqueos FOR UPDATE protegen conversiones concurrentes.
- Las partidas conservan cantidades, precios, descuentos
  e impuestos históricos.
- Los importes se verifican con Prisma.Decimal y los
  resultados calculados por PostgreSQL.
- La creación de una orden no descuenta existencias,
  no registra pagos y no genera eventos Ecommerce.
- La conversión a venta utiliza la persistencia
  transaccional existente de Ventas.
- Una conversión fallida revierte sus escrituras.

## Restricciones PostgreSQL

Migración:
20261030195000_m11_unique_order_conversions

Índices únicos:
- uq_orden_venta_cotizacion_id
- uq_venta_orden_venta_id

Política:
- Una cotización puede originar como máximo una orden.
- Una orden puede originar como máximo una venta.
- Los valores NULL permanecen permitidos.

La migración fue aplicada correctamente en pos_novnix,
esquema pos, y comprobada mediante Prisma y PostgreSQL.

## Integración con Ventas e Inventario

La conversión Orden -> Venta reutiliza:
- Validación de contexto de Ventas.
- Validación de pagos y sesión de caja.
- Comprobación y bloqueo de existencias.
- Persistencia de venta y partidas.
- Movimientos de inventario.
- Movimientos de caja, cuando corresponde.
- Auditoría.
- Outbox de sincronización Ecommerce.

Los movimientos de inventario y registros de outbox se
verificaron durante las pruebas. No se evaluó la entrega
remota al Ecommerce, porque el worker permaneció desactivado.

## Validaciones ejecutadas

Resultados confirmados en desarrollo:

- TypeScript: npx tsc --noEmit sin errores.
- Prisma: esquema válido y migraciones actualizadas.
- PostgreSQL: índices únicos confirmados.
- Cotizaciones + Órdenes: 27/27 pruebas unitarias.
- Ventas: 10/10 pruebas unitarias.
- Integración HTTP M11: 33 verificaciones aprobadas.
- Concurrencia: una venta creada y un reintento rechazado.
- Idempotencia: sin ventas, pagos ni salidas duplicadas.
- Histórico: importes conservados.
- Pagos insuficientes: rechazo y rollback.
- Caja y efectivo: comprobados.
- Inventario y outbox: comprobados.
- JWT, RBAC y aislamiento multiempresa: comprobados
  en los escenarios ejecutados.
- Fixtures sintéticos: limpieza transaccional confirmada.
- Código de salida de integración: 0.

## Comandos de regresión

Desde apps/api:

    npx prisma migrate status
    npx tsc --noEmit
    npx tsx --test tests/quotes/quote-unit.test.ts tests/sales-orders/order-unit.test.ts tests/sales-orders/order-conversion.unit.test.ts
    npm run test:sales

## Integración funcional HTTP

Archivo:
tests/sales-orders/m11-http-pos-novnix.integration.mjs

Las pruebas están diseñadas para pos_novnix, esquema pos,
en PostgreSQL local.

Requieren:
- POS_ALLOW_TEST_DB=SI
- INVENTORY_SYNC_ENABLED=false
- Ningún worker Ecommerce activo sobre la base.

Preflight:

    node --import tsx tests/sales-orders/m11-http-pos-novnix.integration.mjs --preflight

Prueba funcional con fixtures sintéticos:

    node --import tsx tests/sales-orders/m11-http-pos-novnix.integration.mjs --run

La prueba HTTP realiza escrituras sintéticas confirmadas y
después limpia sus propios registros de forma transaccional.
No equivale a una única transacción global con ROLLBACK.

## Consideraciones técnicas

- La autorización de mutaciones utiliza ORDENES.CREAR.
- Los permisos granulares adicionales podrán evaluarse
  cuando se defina su política RBAC.
- FACTURADA no se asigna automáticamente al convertir.
- El script HTTP emite un aviso de deprecación de pg
  asociado al uso concurrente del cliente; no impidió
  la ejecución aprobada y conviene corregirlo posteriormente.
- La sincronización remota del worker Ecommerce no fue
  cubierta por la integración funcional de este módulo.
- No incluir archivos dist, respaldos ni scripts
  temporales ajenos al módulo en el commit.

## Validaciones pendientes de otros módulos

Las pruebas funcionales pendientes de Productos/Catálogo
e Inventario se mantienen como tareas independientes.
Los resultados del Módulo 11 no las sustituyen.
