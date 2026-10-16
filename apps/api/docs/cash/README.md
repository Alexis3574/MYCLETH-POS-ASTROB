# POSMYCLETH — módulo Cajas y sesiones (`cash`)

## Alcance

Implementación propuesta contra el esquema Prisma entregado (octubre de 2026). Incluye catálogo de cajas, apertura de sesiones, una sesión ABIERTA por caja, movimientos manuales con referencia idempotente, cierre con arqueo, reportes de movimientos, historial y registro en `auditoria`. Se reutilizan `pos.caja`, `pos.sesion_caja` y `pos.movimiento_caja`; **no se añade migración** porque el esquema entregado ya declara el índice único parcial `uq_sesion_caja_abierta`.

## Integración

Montar `cashRouter` bajo `/api/v1/cash` en `src/app.ts`. Ejecutar manualmente `npx tsx scripts/create-cash-permissions.ts` en la base autorizada para dar de alta los 6 permisos; su asignación a roles es una tarea administrativa separada.

El módulo calcula el efectivo esperado exclusivamente con el monto de apertura y los movimientos de `movimiento_caja` (incluidos los generados por Ventas, cancelaciones y devoluciones). **No vuelve a agregar `venta_pago` ni `devolucion_pago`**, evitando la doble contabilización.

Se debe usar bloqueo `SELECT ... FOR UPDATE` de la sesión de caja *también en la creación/cancelación de ventas* antes de escribir sus movimientos. El instalador incluye un ajuste conservador al método `findCashSession` existente cuando coincide con la estructura entregada. Verificar manualmente dicho punto si el código actual difiere.

## Endpoints

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/v1/cash?page=1&pageSize=25` | `CAJAS.VER` |
| POST | `/api/v1/cash` | `CAJAS.CREAR` |
| GET | `/api/v1/cash/:cashId` | `CAJAS.VER` |
| PATCH | `/api/v1/cash/:cashId` | `CAJAS.EDITAR` |
| POST | `/api/v1/cash/:cashId/sessions` | `CAJAS.ABRIR` |
| GET | `/api/v1/cash/:cashId/sessions/current` | `CAJAS.VER` |
| GET | `/api/v1/cash/:cashId/sessions?page=1` | `CAJAS.VER` |
| GET | `/api/v1/cash/sessions/:sessionId` | `CAJAS.VER` |
| GET | `/api/v1/cash/sessions/:sessionId/movements?page=1` | `CAJAS.VER` |
| POST | `/api/v1/cash/sessions/:sessionId/movements` | `CAJAS.MOVER` |
| POST | `/api/v1/cash/sessions/:sessionId/close` | `CAJAS.CERRAR` |

### JSON de ejemplo

Crear caja: `{ "sucursal_id":"1", "codigo":"CJ-01", "nombre":"Caja principal" }`

Abrir sesión: `{ "monto_apertura":"300.00", "notas":"Turno matutino" }`

Entrada manual: `{ "tipo":"ENTRADA", "concepto":"Depósito de efectivo", "monto":"100.00", "referencia":"DEPOSITO-0001" }`

Salida manual: `{ "tipo":"SALIDA", "concepto":"Retiro parcial", "monto":"50.00", "referencia":"RETIRO-0001" }`

Cerrar: `{ "monto_cierre":"350.00", "notas":"Arqueo correcto" }`

Los importes se guardan como `DECIMAL(14,2)` y se serializan en cadenas para preservar su exactitud. `referencia` es obligatoria y única por sesión para movimientos manuales; el sistema almacena el prefijo `MANUAL:`. Todo endpoint requiere JWT; el usuario debe estar adscrito a la sucursal de la caja y debe ser el responsable de la sesión para registrar movimientos o cerrar.

## Riesgos y decisiones

- `sucursal_id` se establece al crear la caja y no se modifica: mover una caja ya utilizada corrompería el contexto histórico de sus sesiones.
- Se rechaza desactivar una caja con una sesión abierta.
- El bloqueo de sesiones en el flujo de Ventas y cancelaciones es necesario para evitar registrar efectivo mientras ocurre el cierre.
- Un fallo de Prisma `P2002` devuelve `409`; la restricción única parcial del esquema es esencial para impedir doble apertura.
- Las operaciones afectan a una sola sesión mediante una transacción y conservan trazabilidad básica en `auditoria`.
- Sin acceso al repositorio actualizado, no se ha confirmado si las restricciones CHECK del esquema físico admiten los valores utilizados. Se debe inspeccionar al integrar.

## Estado

**IMPLEMENTACIÓN PREPARADA PARA INCORPORAR. NO VALIDADO.** No se han ejecutado servidor, PostgreSQL, pruebas HTTP, `typecheck`, build, migraciones ni pruebas de concurrencia. El proyecto exige posponer esas comprobaciones hasta concluir los tres módulos pedidos.
