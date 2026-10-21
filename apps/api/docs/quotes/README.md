# POSMYCLETH — Módulo 10: Cotizaciones

## Alcance de esta implementación

Cotizaciones multiempresa sobre las tablas existentes `pos.cotizacion` y `pos.cotizacion_detalle` (sin nuevas migraciones). Todas las consultas exigen JWT y los permisos ya existentes `COTIZACIONES.VER` o `COTIZACIONES.CREAR`. La escritura verifica sucursal, asignación `usuario_sucursal`, cliente y productos activos de la empresa autenticada. `empresa_id` y `usuario_id` nunca se admiten en el cuerpo: se toman de `req.auth`.

La API expone:

| Verbo | Ruta | Permiso | Operación |
|---|---|---|---|
| GET | `/api/v1/quotes` | COTIZACIONES.VER | Listado paginado y filtrado por sucursales asignadas |
| GET | `/api/v1/quotes/:id` | COTIZACIONES.VER | Detalle incluyendo líneas |
| POST | `/api/v1/quotes` | COTIZACIONES.CREAR | Crear BORRADOR |
| PATCH | `/api/v1/quotes/:id` | COTIZACIONES.CREAR | Editar BORRADOR; sucursal y folio inmutables |
| POST | `/api/v1/quotes/:id/send` | COTIZACIONES.CREAR | BORRADOR → ENVIADA |
| POST | `/api/v1/quotes/:id/accept` | COTIZACIONES.CREAR | ENVIADA → ACEPTADA |
| POST | `/api/v1/quotes/:id/reject` | COTIZACIONES.CREAR | ENVIADA → RECHAZADA |
| POST | `/api/v1/quotes/:id/cancel` | COTIZACIONES.CREAR | BORRADOR/ENVIADA → CANCELADA |
| POST | `/api/v1/quotes/:id/expire` | COTIZACIONES.CREAR | ENVIADA → VENCIDA, solo si pasó fecha de validez |

No existe operación `DELETE`. CONVERTIDA se reserva para una integración posterior con Ventas/Órdenes, después de pruebas de concurrencia e idempotencia. Esta API **no crea ventas, no reserva inventario, no genera pagos, no publica eventos Ecommerce**.

## Ejemplo POST (solo datos de la empresa del JWT)

```json
{
  "sucursal_id": "1",
  "cliente_id": "2",
  "folio": "CT-2026-0001",
  "valida_hasta": "2026-11-30",
  "observaciones": "Cotización con validez de 30 días",
  "detalles": [
    { "producto_id": "7", "cantidad": "2.000", "descuento_porcentaje": "5.0000" }
  ]
}
```

Los IDs del ejemplo son ilustrativos: sustituir por identificadores reales que pertenezcan a una misma empresa, con sucursal asignada al usuario del JWT. El cliente puede ser `null` u omitirse. El precio se obtiene del catálogo `producto.precio_venta`; los impuestos activos se suman desde `producto_impuesto`. El cliente **no puede inyectar precio ni tasa de impuesto**. El servidor guarda la instantánea de precio/tasa por línea, y los triggers PostgreSQL `trg_cotizacion_detalle_importes` y `trg_cotizacion_totales` calculan el resto.

`PATCH /:id` solo permite `cliente_id`, `valida_hasta`, `observaciones`, `detalles`. Al incluir `detalles`, se reemplazan todos dentro de una sola transacción. Dejar fuera `detalles` conserva el contenido existente.

## Integridad y concurrencia

- Validación estricta Zod 4, BigInt dentro del rango firmado, decimales expresados como cadenas, rango NUMERIC(14,s), máximo 100 líneas, productos únicos, folios únicos por sucursal.
- Aislamiento `empresa_id` en búsquedas; el acceso de lectura/escritura requiere una asignación a la sucursal.
- `FOR UPDATE` en operaciones de edición/estado dentro de transacción interactiva Prisma: evita transiciones concurrentes sobre la misma cabecera.
- Los triggers PostgreSQL controlan los importes y el recálculo de totales; no se modifica su SQL.
- No permite cambios de estado después de `ACEPTADA`, `RECHAZADA`, `VENCIDA`, `CONVERTIDA` o `CANCELADA`.
- `COTIZACIONES.CREAR` se reutiliza para ediciones y transiciones porque la base no contiene un permiso EDITAR específico. Si se requiere separación de funciones, agregar un permiso expresamente en una iteración posterior.
- No existe tabla específica de idempotencia de cotizaciones; folio único ayuda ante reintentos de creación, mientras que los cambios de estado son condicionales bajo bloqueo. **No garantiza respuestas idempotentes iguales ante reintentos de red**, por lo que no debe emplearse aún para conversión a venta.

## Pruebas disponibles

1. `npm run typecheck`
2. `npx --no-install tsx --test tests/quotes/quote-unit.test.ts`
3. `npx --no-install tsx scripts/quotes/check-quote-setup.ts`
4. `POS_ALLOW_TEST_DB=SI node tests/quotes/quote-postgres.rollback.mjs` (solo `localhost:5432/pos_novnix`; confirma ROLLBACK)
5. Con API local ejecutándose: `POS_ALLOW_TEST_DB=SI POS_HTTP_URL=http://127.0.0.1:3000 node tests/quotes/quote-http.synthetic.mjs` (JWT sintéticos, datos temporales y limpieza transaccional; **si falla la limpieza, no repetir sin inspeccionar**).

Antes de ejecutar cualquier prueba que escriba en PostgreSQL: respaldar base de desarrollo, detener trabajadores Ecommerce y mantener `INVENTORY_SYNC_ENABLED=false`. Nunca correr estas pruebas sobre producción.

**Importante:** los tests HTTP sintéticos están preparados pero no se han ejecutado todavía en el equipo del usuario. No marcar como finalizado ni realizar commit/push antes de aprobar todas las pruebas y su limpieza.

## Evidencia de inspección

Informes 01–08, 2026-10-21: PostgreSQL 17.4, `pos_novnix`, ninguna cotización existente, 3 triggers habilitados, permisos `COTIZACIONES.VER` y `COTIZACIONES.CREAR` existentes. Código base `61f08ad` en `devalex`.
