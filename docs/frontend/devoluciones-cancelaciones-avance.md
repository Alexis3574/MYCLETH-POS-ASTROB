# Frontend — Devoluciones y cancelaciones de ventas

Fecha: 19 de noviembre de 2026.

Estado actualizado al 22 de noviembre de 2026: **IMPLEMENTADO Y VALIDADO CON SIMULADOR; DEVOLUCIÓN TOTAL REAL DESDE EL NUEVO FORMULARIO COMPROBADA. CIERRE DEL DESARROLLADOR PENDIENTE.**

## Objetivo y alcance

Operar sobre una venta desde su detalle existente sin introducir identificadores de base de datos. Se agrega la pestaña «Devoluciones y cancelación» a `/sales/:saleId`, conservando listado, filtros, artículos, pagos y resumen financiero.

Incluye historial con artículos y reembolsos, devolución parcial o total, cantidades aún devolvibles, importes reembolsables por pago original, selección de caja para efectivo, confirmación, cancelación completa, actualización de consultas y revisión de resultados inciertos. No incluye kardex, arqueos, envío de transferencias bancarias, cobranza ni automatización del folio de devolución en el backend.

La creación y cancelación se validaron desde la interfaz contra el simulador. Los endpoints reales ya se habían probado en los ciclos descritos en `pos-modernizacion-avance.md`; esta tanda añadió una comprobación de lectura del historial real, sin nuevas escrituras sobre PostgreSQL. No se atribuyen las pruebas anteriores al formulario nuevo.

## Flujo del operador

1. Buscar una venta en el listado y abrir su detalle.
2. Entrar en «Devoluciones y cancelación». Se consulta el historial antes de habilitar acciones.
3. Para devolver, indicar folio y motivo, seleccionar cantidades dentro del saldo disponible y revisar el total estimado. «Seleccionar todo lo devolvible» prepara el remanente.
4. Capturar reembolsos sobre los pagos originales o usar «Distribuir según pagos originales». Esa ayuda recorre los pagos en su orden y limita cada importe al saldo reembolsable; el operador revisa la distribución antes de confirmar.
5. Si se reembolsa efectivo, seleccionar una sesión propia abierta de la misma sucursal. Se reutiliza el selector actual y los permisos de consulta de caja.
6. Revisar folio, motivo, líneas y total. Volver a editar conserva el folio, motivo, cantidades y reembolsos propuestos; la sesión de caja se consulta nuevamente.
7. Confirmar una sola vez. La pantalla bloquea otro envío y el cierre/cambio de pestaña del detalle mientras espera. Después actualiza historial, documento, resumen financiero y listado.
8. Para cancelar, confirmar la cancelación completa. Una venta cancelada o con devoluciones no permite esta acción. El servidor comprueba también las sesiones originales de efectivo.

El estado documental original y el financiero son distintos: una devolución no convierte automáticamente la venta en CANCELADA. El documento puede conservar COMPLETADA y mostrar DEVUELTA_TOTAL y netos cero en el resumen financiero.

## Contratos reales y permisos

Rutas con prefijo `/api/v1`:

| Método y ruta | Permiso | Utilización |
|---|---|---|
| `GET /sales/:id/returns` | `VENTAS.VER` | Historial completo con detalles y reembolsos; respuesta `{ok,data:{venta,total_devoluciones,total_devuelto,devoluciones}}`. No se inventa paginación. |
| `POST /sales/:id/returns` | `VENTAS.DEVOLVER` | Folio, motivo, sesión opcional, IDs de líneas/cantidades e IDs de pagos/importes/referencias. |
| `PATCH /sales/:id/cancel` | `VENTAS.CANCELAR` | Cancelación total sin cuerpo adicional. |
| `GET /sales/:id` y `/financial-summary` | `VENTAS.VER` | Actualización del documento y su resultado financiero. |
| Consultas existentes de caja/sesión | `CAJAS.VER` | Selección segura del efectivo. |

Se reutilizan autenticación y cliente HTTP. El frontend oculta acciones sin permisos; la API mantiene la autorización definitiva. No se añadieron endpoints, modelos, migraciones, dependencias ni cambios al backend.

El folio de devolución sigue siendo explícito y obligatorio (máximo 50 caracteres). La generación automática implementada previamente para ventas no se extiende silenciosamente a devoluciones. El motivo admite de 3 a 250 caracteres y las referencias de reembolso hasta 150.

## Cantidades, importes y cálculo

El saldo por línea es la cantidad original menos las cantidades del historial, con precisión de tres decimales. El saldo por pago es el importe original menos los reembolsos ya registrados, comparado en centavos. No se utiliza el saldo agrupado de un método como si fuera el de cada pago.

Para una devolución parcial se estima el total de la línea proporcionalmente a cantidad solicitada/cantidad original y se redondea con la secuencia del validador actual. Si se devuelve todo el remanente de una línea, se utiliza el importe original menos los importes ya devueltos; así se absorbe el remanente de centavos. La solicitud no envía precios, impuestos ni totales definitivos: el backend recalcula y comprueba el resultado.

Se rechazan cantidades inválidas/excesivas, líneas ajenas, importes superiores a cada pago, referencias largas, reembolsos insuficientes o excesivos, empresa ajena y estados incompatibles. El efectivo exige una caja activa, sesión abierta y propia, coincidencia de caja/sucursal y fecha de cierre nula. Los IDs se conservan como strings BIGINT.

El contrato del detalle de venta no proporciona `controla_inventario` ni las restricciones de la unidad. No se inventan esos campos: la regla de cantidades enteras para productos con inventario la aplica definitivamente el backend. Se informa en la interfaz que el servidor comprueba las restricciones del producto. No hay endpoint de previsualización de devolución en este flujo.

## Historial y validación de respuestas

Se comprueban formas de respuesta, venta asociada, usuario, identificadores, fechas, cantidades, importes, métodos, referencias y listas. Historiales incompletos, duplicados o con referencias desconocidas no habilitan operaciones. El formulario no interpreta como válido un simple HTTP 2xx cuyo resultado no pueda comprobarse.

El historial muestra folio, fecha UTC, motivo, artículos/cantidades/importes y reembolsos por método. Es una consulta de operaciones de devolución; no sustituye un módulo de kardex o una integración bancaria.

## Prevención de duplicados y resultado incierto

Antes de cada POST/PATCH se guarda una marca en `sessionStorage` bajo `posmycleth.sales.action.pending.v1`. Contiene empresa, usuario, venta, tipo de acción, folio, IDs de devoluciones conocidas y una representación de las líneas/cantidades y pagos/importes esperados. No contiene JWT, contraseña, cliente ni credenciales adicionales. Es información operativa local a la pestaña.

Un bloqueo síncrono impide doble envío desde el componente. Un almacenamiento ilegible o inaccesible bloquea nuevos envíos. Los rechazos definitivos 4xx, salvo 408 y 409, permiten corregir; respuestas perdidas, no interpretables, 408/409 y 5xx conservan la protección. No hay reintento automático de POST/PATCH.

«Comprobar resultado» usa únicamente GET. Para una devolución exige un registro nuevo, no presente antes del intento, con el mismo folio, venta, usuario, cantidades, pagos e importes. Una coincidencia de folio por sí sola no confirma la operación. Para cancelación exige que la venta aparezca CANCELADA. Si no se puede comprobar el resultado, la marca se conserva. La liberación manual requiere declarar que ya se revisó y se puede continuar sin duplicar.

Esto no incorpora idempotencia persistente nueva al backend de devoluciones ni coordina pestañas/equipos distintos. El folio único y las validaciones transaccionales existentes siguen siendo necesarios. El navegador puede repetir un transporte; la protección de interfaz no demuestra que nunca se repitan solicitudes HTTP.

## Arquitectura y archivos

Nuevos, bajo `apps/web/src/features/sales/returns/`:

| Archivo | Responsabilidad |
|---|---|
| `return.types.ts` | Contratos de historial, captura, reembolsos y resultados. |
| `returns.logic.ts` | Saldos, estimación, distribución y validación del cuerpo. |
| `returns.parse.ts` | Lectura y validación de respuestas; separada para pruebas sin Fetch/Vite. |
| `returns.service.ts` | Solicitudes GET/POST/PATCH mediante `apiRequest`. |
| `action.guard.ts` | Marca persistente y correspondencia exacta del resultado con el intento. |
| `useSaleMutation.ts` | Permisos de envío, bloqueo, errores, verificación y liberación. |
| `ReturnForm.tsx` | Captura, selección de cantidades/reembolsos y caja. |
| `SaleOperations.tsx` | Historial, acciones, confirmaciones y operación pendiente. |
| `returns.css` | Presentación responsiva, formularios y mensajes. |

Archivos existentes modificados:

- `apps/web/src/features/sales/SaleDetail.tsx`: pestaña, bloqueo temporal de cierre/navegación interna, mensajes y actualización de recursos.
- `apps/web/src/pages/SalesPage.tsx`: callback de actualización del listado mediante contexto del Outlet.
- `apps/web/tests/pos-fixture-state.mjs`: enlace al modelo de acciones, permisos de devolución/cancelación y resúmenes financieros coherentes.
- `docs/frontend/README.md` y `pos-modernizacion-avance.md`: enlaces de continuidad a este avance.

Pruebas nuevas: `apps/web/tests/sale-returns.test.mjs` y `apps/web/tests/sale-actions-fixture.mjs`. El segundo es el modelo aislado de devoluciones/cancelaciones, con aritmética decimal independiente del estimador frontend. No importa el backend ni configura un proxy a PostgreSQL.

Se reutilizan `useRemoteResource`, `useAuthSession`, `getAuthSession`, `ApiHttpError`, `apiRequest`, `usePermission`, `QueryFeedback`, `CashSessionPicker`, `isSaleId`, formateadores de venta, el detalle y su modal nativo, estilos de ventas y conversiones de centavos existentes.

## Pruebas y resultados

Desde `apps/web`:

```bash
npm run build
npm run lint
node --test tests/sale-returns.test.mjs tests/pos-modernization.test.mjs tests/pos-draft.test.mjs tests/pos-fixture-http.test.mjs tests/pos-logic.test.mjs tests/sales-query.test.mjs
```

Resultados finales: build TypeScript/Vite correcto; ESLint correcto; **47 pruebas aprobadas, 0 fallidas**. Trece corresponden al bloque nuevo y 34 a la regresión previa.

Las pruebas nuevas comprueban saldos acumulados, BIGINT, cantidades inválidas/excesivas, distribución por pagos, precisión, remanente final de centavos, empresa/estado, efectivo propio, parser de historial malformado, marcas dañadas, coincidencia exacta del intento, devoluciones parciales/totales, cancelación, protección contra doble reintegro, permisos independientes y resumen neto de efectivo.

Comprobaciones de navegador con datos sintéticos:

- Apertura de la pestaña y consulta de historial antes de operar.
- Errores por folio vacío y cantidad superior a lo devolvible; mensajes se retiran al editar.
- Devolución parcial: 1 de 3 unidades, 116.00; remanente 2 unidades, 232.00.
- Confirmación, retorno a edición conservando datos y actualización de historial/listado/documento después de registrar.
- Cancelación bloqueada tras una devolución; devolución bloqueada cuando se agotó el saldo.
- Respuesta 503 después del registro, bloqueo, recarga completa y confirmación por GET sin otro envío. La comprobación final se repitió con usuario, líneas e importes exactos.
- Cancelación con respuesta perdida y verificación posterior del estado CANCELADA.
- Usuario sin permisos de mutación: consulta disponible y acciones ausentes.
- Historial malformado: error sin habilitar acciones.
- Devolución simulada en efectivo, selección de una sesión propia abierta y registro correcto.
- Móvil de 390 px: campos y confirmación legibles; documento de 375 px y modal de 390 px dentro de la ventana, sin desbordamiento global. Se restauró el tamaño normal al terminar.

La revisión normal final en el caso móvil no registró errores/advertencias de consola. Los HTTP 503 de los casos de incertidumbre fueron deliberados. El simulador usa una política simplificada de datos y no demuestra los bloqueos reales de PostgreSQL para esta interfaz.

El puerto 5174 tenía una instancia anterior; la validación actual utilizó una nueva instancia aislada en **5180**. Se prepararon también dos ventas sintéticas en la instancia anterior al detectar la ocupación; no se utilizaron como evidencia del código nuevo ni tocaron datos reales.

Consulta real adicional: la nueva pestaña abrió correctamente la devolución existente 20 de la venta 82, folio `DEV-QA-VTA-1-20261119-000003`, importe 1135.94, artículo y reembolso por transferencia. Ambas acciones quedaron deshabilitadas por devolución total. Se habilitó únicamente GET del historial en la envoltura local de solo consultas. No se creó ni modificó ninguna operación real durante esta tanda; el stock real continúa con la unidad conservada en la prueba anterior.

## Repetición y pendientes

```bash
cd ~/Documentos/POSMYCLETH/apps/web
POS_FIXTURE_PORT=5180 node tests/pos-browser-fixture.mjs
```

El simulador comienza sin ventas al reiniciarlo. Preparar una venta sintética mediante su POS y abrirla desde Ventas. `?fixture=read-only` elimina permisos de mutación; `?fixture=returns-malformed` devuelve un historial inválido; `?fixture=cancel-uncertain` cancela y responde 503. Un folio de devolución que empiece con `UNCERTAIN` registra y responde 503; con `MALFORMED` registra y devuelve un resultado incompleto. Son controles exclusivos del simulador.

Pendientes:

1. Escritura real total por transferencia desde el formulario: comprobada el 22 de noviembre en el caso descrito al final. Quedan por validar las demás combinaciones reales detalladas en el punto 3.
2. Conservar el protocolo de stock inicial/final 1 para cada prueba real y el worker detenido; si no coincide, detener el siguiente caso. No ejecutar ajustes directos ni borrar historial para forzar el resultado.
3. Validar reembolsos reales en efectivo/crédito, otras combinaciones de pagos, roles y cambios concurrentes. Las pruebas simuladas no los sustituyen.
4. Valorar una previsualización e idempotencia de devoluciones y folio automático desde backend como un alcance posterior explícito. Esta tanda conserva los contratos existentes.
5. Confirmación del desarrollador antes del cierre funcional y de cualquier commit de módulo.

Las evidencias visuales se conservaron fuera del repositorio. No hubo staging, commits, push o PR. No se instalaron dependencias ni se modificaron backend, esquema, reglas AGENTS.md o contexto maestro v1.1. Los hashes de estas dos fuentes se verificaron sin cambios. Las modificaciones anteriores y ajenas se conservaron.

## Validación real desde el formulario — 22 de noviembre de 2026

Con la sesión iniciada manualmente por el usuario y el alcance previamente autorizado, se registró una unidad de Smart Home Speaker, SKU `WG-119-A1-A2`, producto 1, almacén/sucursal 1, precio 1135.94 y pago por transferencia 3, sin cliente ni sesión de caja. La venta 83 obtuvo el folio `VTA-1-20261123-000001`; el servidor asigna el día del folio en UTC, por eso figura 23 de noviembre durante la noche local del día 22.

Desde Ventas → Detalle → Devoluciones y cancelación se preparó, revisó y confirmó la devolución total `DEV-QA-VTA-1-20261123-000001`, motivo «Prueba controlada de devolución total y restauración de stock» y referencia de reembolso `DEVOLUCION-PRUEBA-LOCAL-POS`. El formulario confirmó el registro de la devolución 21 por 1135.94 y mostró artículo, cantidad 1 y un reembolso de transferencia por el mismo importe.

Las consultas de comprobación confirmaron `DEVUELTA_TOTAL`, venta/pagos netos 0, una devolución y un reembolso. Se conservaron la venta original COMPLETADA, su pago y operación de idempotencia. Movimiento 527: SALIDA de 1 por VENTA; movimiento 528: ENTRADA de 1 por DEVOLUCION_VENTA. Ambas sincronizaciones quedaron PENDIENTE, ajustes -1/+1 e intentos 0; el worker no se inició. El stock terminó en cantidad 1.000, reservado 0.000, disponible 1.000, también visible en Inventario.

Preparar devolución y Cancelar venta completa quedaron deshabilitados tras la devolución total. No se intentó cancelar de nuevo ni se modificó directamente el inventario. La envoltura temporal admitió únicamente la venta y devolución exactas autorizadas; después se cerró, descartando la credencial mantenida en memoria, y se restableció la API de revisión de solo consultas. Las imágenes `devolucion-formulario-real-83.jpg` y `devolucion-formulario-stock-83.jpg` se conservaron fuera del repositorio. No se realizó ningún commit.
