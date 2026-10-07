# Módulo `sales`

## Alcance

El módulo administra creación, consulta, cancelación y devolución de ventas. Los importes se calculan en backend, el usuario se toma del JWT y todas las consultas se limitan a la empresa del usuario autenticado.

## Endpoints

| Método | Ruta | Permiso | Función |
|---|---|---|---|
| POST | `/api/v1/sales` | `VENTAS.CREAR` | Crear venta |
| GET | `/api/v1/sales` | `VENTAS.VER` | Listar y filtrar ventas |
| GET | `/api/v1/sales/:id` | `VENTAS.VER` | Consultar detalle |
| GET | `/api/v1/sales/:id/financial-summary` | `VENTAS.VER` | Consultar resumen financiero |
| PATCH | `/api/v1/sales/:id/cancel` | `VENTAS.CANCELAR` | Cancelar venta |
| POST | `/api/v1/sales/:id/returns` | `VENTAS.DEVOLVER` | Registrar devolución |
| GET | `/api/v1/sales/:id/returns` | `VENTAS.VER` | Listar devoluciones |
| GET | `/api/v1/sales/:id/returns/:returnId` | `VENTAS.VER` | Consultar devolución |

## Concurrencia e idempotencia

La creación de ventas bloquea cada existencia necesaria con `SELECT ... FOR UPDATE` y adquiere los bloqueos en orden de `producto_id`. Esto evita que dos ventas consuman simultáneamente el mismo stock disponible.

El folio de venta está protegido por el índice único `(sucursal_id, folio)`. Una repetición concurrente del mismo folio puede completar una sola venta; el segundo intento termina en `409 SALE_FOLIO_ALREADY_EXISTS` y su transacción se revierte completa.

La cancelación bloquea la fila de la venta con `FOR UPDATE`. Dos cancelaciones concurrentes no pueden duplicar inventario ni movimientos de caja: la primera cambia el estado a `CANCELADA` y la segunda recibe `409 SALE_CANNOT_BE_CANCELLED`.

Las devoluciones también bloquean la misma fila de venta con `FOR UPDATE`. Por ello una devolución concurrente con otra devolución o con una cancelación se serializa antes de validar cantidades y montos acumulados.

La sincronización Ecommerce usa una outbox local en `sincronizacion_ecommerce_inventario`. Cada operación tiene `operation_id` único. El worker reclama registros mediante cambio atómico de `PENDIENTE` a `PROCESANDO` y el Ecommerce recibe el mismo `operation_id` en los reintentos.

## Pagos y crédito

Los métodos soportados por datos son `EFECTIVO`, `TARJETA`, `TRANSFERENCIA`, `CREDITO` y `OTRO`.

Solamente los métodos con `es_efectivo = true` crean `movimiento_caja`. Los demás métodos se registran en `venta_pago` sin afectar caja física.

Una venta que incluya un pago cuyo código sea `CREDITO` queda con `condicion_pago = CREDITO` y ahora requiere `cliente_id`. El módulo todavía no descuenta saldo de una cuenta por cobrar porque ese módulo aún no existe. El resumen financiero expone el monto de crédito neto después de devoluciones, además de `limite_credito` y `dias_credito` configurados en el cliente, para que el futuro módulo de cuentas por cobrar tenga una base estable.

## Devoluciones

Las devoluciones pueden ser completas, parciales o acumulativas. Se valida que la cantidad total devuelta no supere la vendida y que el reembolso acumulado por `venta_pago` no supere el monto original de ese pago.

Los reembolsos `TRANSFERENCIA` y `CREDITO` no requieren sesión de caja y no generan `movimiento_caja`. Un reembolso de un pago en efectivo exige una sesión de caja abierta y genera una `SALIDA`.

Una venta con devoluciones no puede cancelarse posteriormente (`409 SALE_HAS_RETURNS`).

## Resumen financiero

`GET /api/v1/sales/:id/financial-summary` devuelve:

- total original de la venta;
- total de pagos registrados;
- total devuelto;
- total revertido por cancelación;
- total neto de venta;
- total neto de pagos;
- estado financiero (`VIGENTE`, `DEVUELTA_PARCIAL`, `DEVUELTA_TOTAL` o `CANCELADA`);
- desglose por método de pago;
- flujo de efectivo original, devuelto, revertido y neto;
- bloque de crédito cuando la venta incluye `CREDITO`.

`cuentas_por_cobrar_integrado` se mantiene en `false` hasta que exista el módulo de cuentas por cobrar.

## Auditoría

La creación de venta, cancelación y creación de devolución registran una fila en `auditoria` dentro de la misma transacción de negocio. Si la auditoría falla, la operación completa se revierte.

Acciones registradas:

- `tabla = venta`, `accion = INSERT`;
- `tabla = venta`, `accion = UPDATE`;
- `tabla = devolucion_venta`, `accion = INSERT`.

También se conserva `usuario_id`, `registro_id`, datos relevantes de la operación e IP de origen cuando Express la proporciona.

## Pruebas automatizadas

Ejecutar:

```bash
npm run typecheck
npx prisma validate
npm run test:sales
```

Las pruebas automatizadas cubren utilidades monetarias, cálculo de totales, igualdad entre total y pagos, validaciones de esquemas y protección del rango `BIGINT` en filtros.

Las pruebas de concurrencia deben ejecutarse contra PostgreSQL real porque dependen de `FOR UPDATE`, índices únicos y transacciones. No deben simularse como pruebas unitarias.

## Pruebas finales de concurrencia e integración

Estas pruebas usan PostgreSQL real y una instancia del API ya levantada. Crean folios de prueba únicos. La venta usada para probar cancelación concurrente se cancela al final; las ventas usadas para probar devoluciones permanecen como historial de prueba con devolución total.

En Git Bash:

```bash
export SALES_TEST_TOKEN="$TOKEN"
export SALES_TEST_API_URL="http://localhost:3000/api/v1"
npm run test:sales:integration
```

La prueba de integración verifica automáticamente:

- dos creaciones concurrentes con el mismo folio: una `201` y una `409 SALE_FOLIO_ALREADY_EXISTS`;
- dos cancelaciones concurrentes: una `200` y una `409`;
- dos devoluciones concurrentes de la misma unidad: solo una se aplica;
- devolución `TRANSFERENCIA` sin `movimiento_caja`;
- devolución `CREDITO` sin `movimiento_caja`;
- resumen financiero después de devolución total;
- auditoría de creación, cancelación y devolución;
- bloque de crédito preparado para el futuro módulo de cuentas por cobrar.
