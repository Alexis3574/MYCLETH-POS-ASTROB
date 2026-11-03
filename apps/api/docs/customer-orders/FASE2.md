# POSMYCLETH M12 — Fase 2 candidata: Pedido de Cliente → Venta

**No publicada.** Debe pasar `tsc`, pruebas unitarias/regresión y prueba HTTP/PostgreSQL con fixture y limpieza segura antes de hacer commit o push.

## Contrato

`POST /api/v1/customer-orders/:id/convert-to-sale`

Permisos obligatorios: `PEDIDOS.CREAR` **y** `VENTAS.CREAR`. Identidad obtenida del JWT.

```json
{
  "folio": "VTA-M12-0001",
  "almacen_id": "1",
  "sesion_caja_id": null,
  "pagos": [{ "metodo_pago_id": "1", "monto": "208.80" }],
  "observaciones": "Venta desde pedido listo"
}
```

- Únicamente pedidos en estado `LISTO`. El pedido se queda `LISTO` después de la conversión: `FACTURADO` es fiscal y `ENTREGADO` describe un evento de entrega que todavía necesita definición de negocio.
- Venta **completa**, no parcial. Bajo bloqueo `FOR UPDATE` en `pos.pedido_cliente`, se rechaza cualquier pedido con venta vinculada, aunque esa venta esté cancelada. **La base sigue permitiendo 1:N** porque no agregamos un índice único ni migración; esta es una regla transitoria de aplicación que no protege contra escritores externos a este endpoint.
- El cuerpo rechaza atributos arbitrarios (empresa, usuario, cliente, partidas, precios, impuestos, totales).
- La transacción copia los montos originales del pedido (sin recalcular precios desde catálogo) y confirma integridad de partidas/cabecera; exige pago exacto en centavos y valida almacén, usuario, cliente, caja y stock actuales.
- Reutiliza `persistCompletedSale` del módulo de Ventas, que escribe `venta`, sus partidas y pagos, inventario, caja, outbox de Ecommerce y auditoría. La asociación `pedido_cliente_id` se escribe en la misma transacción.
- Antes del COMMIT compara cabecera y partidas históricas contra lo registrado. Toda diferencia revierte la transacción.
- El módulo no debe reservar stock ni publicar eventos durante la creación/cambios de estado del pedido; únicamente la venta completada puede realizar los movimientos.

## Riesgos y limitaciones

1. No existe `UNIQUE(venta.pedido_cliente_id)`; la exclusión de conversiones duplicadas funciona **solo** entre solicitudes de este endpoint que bloquean el mismo pedido. La inserción directa desde SQL u otro proceso podría violar la regla. Antes de producción, definir si los pedidos podrán tener ventas parciales y exigir una política de concurrencia respaldada por PostgreSQL.
2. La persistencia heredada de Ventas utiliza `number`. Se compara lo persistido con `Prisma.Decimal` para forzar `ROLLBACK` ante cualquier discrepancia de centavos o cantidades. Para perfeccionar casos límite, migrar dinero a Decimal de forma global después de pruebas de regresión.
3. No se incorpora idempotencia con llave formal. Una segunda conversión recibe HTTP 409, no devuelve automáticamente la venta anterior.
4. La semántica de cancelar una venta vinculada, revertir un pedido, reservar stock, marcar `ENTREGADO` y asignar `FACTURADO` requiere decisiones de negocio. El endpoint no fuerza estos estados.
5. Para pago en efectivo, es indispensable una sesión de caja abierta del mismo usuario/sucursal. Pagos a crédito mantienen las reglas de Ventas.
6. Errores de SQL o conflictos no contemplados pueden resultar en HTTP 500; registrar diagnóstico sin exponer datos del negocio.

## Validaciones iniciales — sin escrituras en PostgreSQL

```bash
cd /c/Users/taiga/Documentos/POSMYCLETH/apps/api || exit 1
npx tsc --noEmit || exit 1
npx tsx --test tests/customer-orders/customer-order-unit.test.ts tests/customer-orders/customer-order-conversion.unit.test.ts || exit 1
npx tsx --test tests/quotes/quote-unit.test.ts tests/sales-orders/order-unit.test.ts tests/sales-orders/order-conversion.unit.test.ts || exit 1
npm run test:sales || exit 1
git diff --check || exit 1
git status --short --branch
```

Antes de declarar la fase validada, preparar y ejecutar una prueba HTTP/PostgreSQL **con registros sintéticos, propiedad verificada y limpieza transaccional** sobre `pos_novnix.pos` (con workers detenidos). Debe cubrir: 401/403, 404 multiempresa, 409 estado o segundo intento, validaciones 400/422, pago e inventario insuficiente, concurrencia de conversión, integridad histórica, venta+detalle+pagos+movimiento+outbox, cash, rollback si falla y restauración completa de conteos.

**No ejecutar** `prisma migrate reset`, `db push`, `git clean`, commit o push automáticamente.

Las pruebas funcionales independientes pendientes de Productos/Catálogo e Inventario continúan abiertas.
