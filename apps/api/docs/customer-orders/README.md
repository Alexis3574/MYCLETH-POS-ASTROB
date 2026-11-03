# POSMYCLETH — Módulo 12: Pedidos de Clientes (Fase 1 candidata)

## Estado

Paquete preparado **fuera del repositorio del usuario**. No se ha compilado ni ejecutado en el backend local del usuario. No se ha aplicado SQL, realizado commit ni push. La validación de tipos, las pruebas unitarias y la integración HTTP/PostgreSQL están pendientes hasta observar resultados reales.

## Contexto comprobado el 30 de octubre de 2026

- Base local **pos_novnix**, esquema **pos** (única base autorizada para estas pruebas).
- Tablas existentes: `pedido_cliente` (17 columnas) y `pedido_cliente_detalle` (12 columnas).
- Tres triggers de timestamp, cálculos de líneas y totales.
- Restricción única `(sucursal_id, folio)`; no se agrega una migración en Fase 1.
- Permisos RBAC existentes: `PEDIDOS.VER`, `PEDIDOS.CREAR`.
- La relación `venta.pedido_cliente_id` permite **varias ventas** por pedido; no se cambia a 1:1.
- La restricción `ck_venta_un_solo_origen` evita múltiples tipos de documento origen en una venta.

## Contrato HTTP propuesto

| Método | Endpoint | Permiso |
|---|---|---|
| GET | `/api/v1/customer-orders` | `PEDIDOS.VER` |
| GET | `/api/v1/customer-orders/:id` | `PEDIDOS.VER` |
| POST | `/api/v1/customer-orders` | `PEDIDOS.CREAR` |
| PATCH | `/api/v1/customer-orders/:id` | `PEDIDOS.CREAR` |
| POST | `/api/v1/customer-orders/:id/confirm` | `PEDIDOS.CREAR` |
| POST | `/api/v1/customer-orders/:id/prepare` | `PEDIDOS.CREAR` |
| POST | `/api/v1/customer-orders/:id/ready` | `PEDIDOS.CREAR` |
| POST | `/api/v1/customer-orders/:id/deliver` | `PEDIDOS.CREAR` |
| POST | `/api/v1/customer-orders/:id/cancel` | `PEDIDOS.CREAR` |

La creación toma `sucursal_id`, `cliente_id`, `folio`, referencia y fecha opcionales, observaciones y una o más líneas con `producto_id`, `cantidad`, `descuento_porcentaje` y descripción opcional. Los precios e impuestos proceden del catálogo; no se aceptan del cliente. La edición solo se admite en `PENDIENTE`. La API no acepta `empresa_id`, `usuario_id`, importes ni estados enviados por el cliente.

## Ciclo de vida de Fase 1 (propuesta de negocio)

`PENDIENTE -> CONFIRMADO -> EN_PREPARACION -> LISTO -> ENTREGADO`.

`CANCELADO` se permite desde `PENDIENTE`, `CONFIRMADO`, `EN_PREPARACION` o `LISTO` solo si no hay venta asociada. `ENTREGADO`, `FACTURADO` y `CANCELADO` son terminales **en esta fase**. Aunque PostgreSQL permite `FACTURADO`, no hay endpoint que lo asigne; su definición fiscal/comercial queda pendiente. `ENTREGADO` representa registro de entrega a nivel pedido, **no genera venta ni salida de inventario**: deberá revisarse junto con el flujo de cumplimiento/ventas.

## Integridad y alcance

- JWT como fuente única de empresa/usuario; usuario activo y desbloqueado, empresa activa.
- Acceso a sucursal únicamente con asignación `usuario_sucursal`; cliente y producto activos de la misma empresa.
- Números decimales con precisión estricta, importes limitados y triggers PostgreSQL como fuente de totales.
- `FOR UPDATE` por documento en edición y transiciones; auditoría de cada modificación.
- Creación/confirmación/preparación/entrega/cancelación del pedido **no reserva, no descuenta stock, no paga, no mueve caja ni genera outbox Ecommerce**.
- No se inserta ni modifica `venta`, `existencia`, `movimiento_inventario` o `sincronizacion_ecommerce_inventario` desde este módulo.
- La conversión Pedido → Venta, la facturación y el control de entregas/ventas parciales quedan para **Fase 2**, con prueba de concurrencia y definición del cumplimiento.

## Validaciones necesarias para aceptar Fase 1

1. `npx tsc --noEmit` sin errores.
2. `npx tsx --test tests/customer-orders/customer-order-unit.test.ts` aprobado.
3. `npx tsx --test tests/quotes/quote-unit.test.ts tests/sales-orders/order-unit.test.ts tests/sales-orders/order-conversion.unit.test.ts` aprobado.
4. `npm run test:sales` aprobado.
5. `git diff --check` sin errores; revisar archivos antes de stage.
6. Integración HTTP real con JWT/roles, esquema `pos`, fixtures marcados y limpieza segura sobre **pos_novnix** antes del cierre del módulo.

## Pendientes anteriores

Las validaciones funcionales completas de **Productos/Catálogo e Inventario** permanecen abiertas y no se consideran aprobadas por el presente módulo.
