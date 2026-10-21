# Módulo 7 — Compras (Purchases)

**Estado:** IMPLEMENTACIÓN PREPARADA, SIN PRUEBAS POSTGRESQL/HTTP EJECUTADAS. Ningún comando se ha aplicado en la computadora del usuario.

## Alcance

- CRUD limitado a creación de borradores, consulta de lista y detalle; no modifica los detalles después de crear el documento.
- Recepción total del borrador invocando `pos.sp_recibir_compra(bigint,bigint)`.
- Cancelación de borrador o recibido invocando `pos.sp_cancelar_compra(bigint,bigint,text)`.
- Pagos parciales o totales, sin exceder el importe y sin permitir pago de borradores/canceladas.
- Caja: todo pago con `metodo_pago.es_efectivo=true` requiere sesión abierta del mismo usuario/sucursal y saldo disponible. Se registra `movimiento_caja.SALIDA` y `compra_pago` en la misma transacción.
- Cancelaciones de compras con pagos: rechazadas para evitar reembolsos sin trazabilidad financiera.
- Outbox: un registro por movimiento de recepción/cancelación en `sincronizacion_ecommerce_inventario`, atómico con la operación de compra.
- Auditoría por acción y aislamiento `empresa_id`.
- Idempotencia persistente de `CREAR`, `RECIBIR`, `PAGAR`, `CANCELAR` con `Idempotency-Key` UUID mediante nueva tabla `pos.operacion_compra`.

## Límites explícitos

1. La recepción es total: el esquema físico no contempla recepción parcial. **No** se implementa recepción parcial ni edición posterior de detalles.
2. El procedimiento usa `compra_detalle.precio_unitario` como costo de entrada, **antes de descuentos**. El costo promedio que modifica el trigger de existencias aplica esa regla existente. No actualizamos `producto.costo_referencia` porque el promedio por almacén es la fuente correcta del costo de existencia.
3. Para evitar un ajuste Ecommerce incompatible, toda partida inventariable requiere `codigo_barras` y cantidad entera positiva <= 2147483647. Las partidas no inventariables pueden tener fracciones cuando su unidad las permite.
4. La integración existente asume un agregado por producto para Ecommerce. Compras genera ajustes por recepción/cancelación; transferencias no generan outbox porque solo mueven existencias entre almacenes.
5. Solo usuario con `usuario_sucursal` y empresa válida puede crear y mutar compras; se reutilizan permisos `COMPRAS.VER`, `COMPRAS.CREAR` (también para recibir y pagar) y `COMPRAS.CANCELAR`. No se alteran los registros de permisos existentes.
6. Se utilizan las restricciones y triggers del esquema físico inspeccionado el 20/10/2026. Si cambian, debe repetirse inspección.
7. **Compatibilidad heredada de cierre de caja:** `pos.sp_cerrar_caja` suma `compra_pago` de efectivo y también descuenta `movimiento_caja.SALIDA`. Al registrar ambos, el procedimiento legado produciría una doble deducción. El servicio HTTP `cash.service.close` calcula desde movimientos, pero NO debe ejecutarse `sp_cerrar_caja` como vía alternativa hasta reconciliar el contrato. No se modifica aquí el procedimiento existente.
8. Si un worker de Ecommerce está activo mientras se hacen pruebas de integración, podría publicar eventos sintéticos. **Detenga otros servidores/workers que apunten a la misma base antes de ejecutar las pruebas**. Definir una variable de entorno en la consola de pruebas solo deshabilita el worker de ese proceso, no el de otros procesos.

## Rutas HTTP

Requieren JWT; las mutaciones requieren cabecera `Idempotency-Key` UUID distinta por operación (reintentos usan la misma).

| Método | Ruta | Permiso |
| --- | --- | --- |
| GET | `/api/v1/purchases` | COMPRAS.VER |
| GET | `/api/v1/purchases/:id` | COMPRAS.VER |
| POST | `/api/v1/purchases` | COMPRAS.CREAR |
| POST | `/api/v1/purchases/:id/receive` | COMPRAS.CREAR |
| POST | `/api/v1/purchases/:id/payments` | COMPRAS.CREAR |
| POST | `/api/v1/purchases/:id/cancel` | COMPRAS.CANCELAR |

El `empresa_id` y el `usuario_id` se toman del JWT, no del JSON del solicitante.

### Ejemplo creación

```json
{
  "sucursal_id": "1", "almacen_id": "1", "proveedor_id": "1",
  "folio": "CMP-0001", "factura_proveedor": "F-2026-100",
  "detalles": [{ "producto_id": "1", "cantidad": "2.000", "precio_unitario": "15.5000", "descuento_porcentaje": "0", "tasa_impuesto": "16" }]
}
```

Los totales se calculan en PostgreSQL. Se devuelven decimales monetarios como cadenas para evitar pérdida de precisión en JSON.

### Ejemplo pago

```json
{ "metodo_pago_id": "1", "monto": "15.00", "referencia": "FAC-100" }
```

Si el método es efectivo debe indicarse `sesion_caja_id`.

### Ejemplo cancelación

```json
{ "motivo": "Compra de prueba cancelada" }
```

## Instalación (NO AUTOMÁTICA)

1. Extraer el paquete fuera del repositorio, por ejemplo `C:/Users/taiga/Documentos/pos-purchases-module/`.
2. Abrir Git Bash y `cd /c/Users/taiga/Documentos/POSMYCLETH/apps/api`.
3. Previsualizar: `node "/c/Users/taiga/Documentos/pos-purchases-module/tools/install-purchases.mjs" --check`.
4. Instalar con el mismo comando y `--install` solamente después de revisar cambios y confirmar que rama es `devalex`.
5. Comprobar `git diff -- src/app.ts prisma/schema.prisma`, `git status --short`, `npx prisma validate`, `npx prisma migrate status`.
6. Revisar la única migración SQL, **no ejecutar sin comprobar la base de datos**. Cuando la base sea `pos_novnix` y la historia de migraciones esté en estado esperado: `npx prisma migrate deploy`.
7. Ejecutar `npx prisma generate` y `npm run typecheck`.
8. Verificación física solo lectura: `npx tsx scripts/purchases/check-purchases-setup.ts`.
9. Pruebas unitarias: `npx tsx --test tests/purchases/purchase-unit.test.ts`.
10. Solo con datos sintéticos y trabajador Ecommerce detenido: configurar las variables y ejecutar `npx tsx tests/purchases/purchase-postgres.integration.ts`.
11. Preparar pruebas HTTP JWT reales e integrar la regresión global existente antes de aprobar el módulo.

## Seguridad de migración

La migración incorpora exclusivamente la tabla `pos.operacion_compra` y su índice. No altera las seis áreas aprobadas ni sus procedimientos. **No** incluir `dist/` en commits. El instalador guarda copia de `src/app.ts` y `prisma/schema.prisma` en `purchases-install-backup/`; no mueve, restaura ni borra cambios previos.

## Estados de validación

- Inspección previa: basada en archivos adjuntos y reportes SQL.
- Código: generado, sin compilar dentro del entorno local del usuario.
- Migración: preparada, no aplicada.
- Pruebas: código preparado; ejecución de PostgreSQL, JWT, regresión HTTP, concurrencia contra DB local pendiente.
- Commit/push: no realizados.
