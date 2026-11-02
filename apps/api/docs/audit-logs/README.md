# M14 — Auditoría / Audit Logs

## Estado
Versión funcional de consultas finalizada.
Backend POSMYCLETH: Express, TypeScript, Prisma y PostgreSQL.

## Rutas
- GET /api/v1/audit-logs
- GET /api/v1/audit-logs/:id

Requieren JWT y permiso AUDITORIA.VER.
Aplican aislamiento empresarial y autorización de sucursal.
No existen rutas de escritura de auditorías.

## Funcionalidad
- Listado, detalle, filtros y paginación.
- Validación de identificadores y parámetros.
- Protección de datos mediante campos permitidos.
- Denegación por defecto de eventos no atribuibles.
- Control empresarial y de sucursales.
- Transferencias: acceso a origen y destino.
- Eventos empresariales: acceso ADMIN autorizado.

## Cobertura configurada
20 entidades:
venta, devolucion_venta, compra, cotizacion,
orden_venta, pedido_cliente, ajuste_inventario,
transferencia_almacen, cliente, cliente_direccion,
proveedor, proveedor_direccion, empresa, sucursal,
almacen, usuario_sucursal, caja, sesion_caja,
movimiento_caja y sincronizacion_ecommerce_inventario.

## Validaciones realizadas
- Pruebas unitarias.
- Integración PostgreSQL en solo lectura.
- Autenticación y autorización HTTP.
- Filtros, paginación y respuestas de error.
- Aislamiento por empresa y sucursal.
- Revocación dinámica simulada.
- Escenarios SQL sintéticos de seguridad.
- Integridad del historial existente.

11 entidades verificadas con documentos reales.
9 entidades no verificadas con documentos reales
por ausencia de registros.

En las verificaciones previas existían 44 eventos
históricos conservados.

## Pendientes posteriores al cierre
- Pruebas de las nueve entidades sin documentos reales.
- Aislamiento HTTP entre dos empresas reales.
- Revocación HTTP con cambios reales de asignaciones.
- Atribución persistente de empresa y sucursal.
- Endurecimiento de privilegios de PostgreSQL.
- Inmutabilidad del historial a nivel de base de datos.
- Revisión de ON DELETE SET NULL de auditoria.usuario_id.
- Rendimiento con volúmenes elevados.

Las pruebas simuladas no sustituyen las pruebas reales.
La versión se cierra funcionalmente sin declarar
implementado el endurecimiento avanzado de PostgreSQL.
