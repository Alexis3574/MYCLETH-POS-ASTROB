# Ventas / POS — automatización y operación ágil

Fecha: 19 de noviembre de 2026.

Estado: **IMPLEMENTADO EN CÓDIGO, VALIDADO EN AISLAMIENTO. MIGRACIÓN APLICADA Y CICLOS REALES DE VENTA, CANCELACIÓN Y DEVOLUCIÓN TOTAL VERIFICADOS EN DESARROLLO LOCAL. PRUEBAS INTEGRALES Y CIERRE PENDIENTES.**

Este avance complementa `operacion-comercial-avance.md`. Sus resultados históricos no se atribuyen a esta tanda. La conexión de producción ya usa los servicios HTTP reales y el proxy de Vite; no se sustituyó por el simulador.

## Objetivo y problemas corregidos

El POS exigía escribir un folio, introducir importes completos manualmente y seleccionar explícitamente una sesión propia incluso cuando solo existía una caja. La búsqueda general admitía lectores como teclado, pero no agregaba por coincidencia exacta ni restauraba el foco para captura consecutiva. La protección visual ante respuestas inciertas dependía del folio y no constituía idempotencia persistente del servidor.

La mejora conserva autenticación, layout, permisos, servicios, carrito, reglas de precios/impuestos y transacciones existentes. No introduce dependencias ni implementa módulos futuros.

## Funcionamiento implementado

1. Elegir un almacén autorizado. Si la API devuelve exactamente uno en todo el catálogo y está activo, se selecciona automáticamente; no se asume unicidad a partir de una página incompleta.
2. Escanear código de barras o SKU y pulsar Enter. Solo una coincidencia exacta, activa y sin ambigüedad se agrega automáticamente. Los resultados parciales o ambiguos requieren seleccionar desde el catálogo existente. F2 enfoca el lector fuera de diálogos.
3. Repetir el producto aumenta su cantidad en una línea. El buscador conserva el foco después de una consulta terminada. Las consultas se cancelan al abandonar la pantalla y se descartan si cambia la sesión.
4. Seleccionar cliente cuando corresponda, conservar descuentos/cantidades y revisar el total estimado. El backend continúa calculando los importes definitivos.
5. Agregar pago propone el importe pendiente. «Completar importe pendiente» recalcula la línea excluyéndola de la suma. No se adivina el método de pago. Crédito sigue requiriendo cliente.
6. En efectivo se puede introducir el recibido para calcular cambio. Es una ayuda local opcional: no altera el importe aplicado ni se envía a la API; no es un movimiento de caja adicional ni un dato persistente del comprobante. Un recibido insuficiente o inválido presenta un mensaje, no un cambio negativo.
7. Una única caja asignada se preselecciona. Una sesión se incorpora al cobro solo si corresponde a esa caja/sucursal, está abierta y pertenece al usuario. Si hay varias cajas, el operador elige. El servidor conserva la validación definitiva.
8. Revisar la confirmación y registrar. El folio se asigna en el servidor; se muestra junto con el importe confirmado y el acceso al detalle.
9. Si se pierde la respuesta, la captura queda bloqueada y «Consultar resultado del intento» recupera el registro mediante GET, sin reenviar la venta. Un 404 no demuestra que otra petición no siga en curso. La liberación manual existente exige declarar que se revisó el resultado.

## API y compatibilidad

| Contrato | Comportamiento |
|---|---|
| `POST /api/v1/sales` con `folio` explícito | Conserva la compatibilidad anterior; `clave_idempotencia` es opcional en este modo. Sin clave no se garantiza idempotencia y no se consultan las tablas nuevas. |
| `POST /api/v1/sales` sin `folio` | Requiere `clave_idempotencia` UUID. Un folio vacío explícito sigue siendo inválido. |
| Mismo UUID y misma solicitud | Devuelve la respuesta original almacenada, sin repetir efectos. UUID se normaliza a minúsculas. |
| Mismo UUID con otro contenido o usuario | HTTP 409 `SALE_IDEMPOTENCY_CONFLICT`. |
| `GET /api/v1/sales/operations/:key` | Requiere autenticación y `VENTAS.CREAR`; consulta solo la empresa del JWT y el usuario que registró. Devuelve 404 para intentos ajenos o sin resultado confirmado. |

La empresa del POST debe coincidir con el JWT; el vendedor se obtiene exclusivamente de la sesión. No se modifican precios, stock, impuestos, pagos ni contratos E-commerce. La recuperación devuelve una **instantánea del registro original**, no el estado actualizado después de una cancelación o devolución; el detalle de venta conserva esa consulta actual.

Se reutilizan las consultas de productos, clientes, stock, almacenes, métodos y sesiones descritas en el avance anterior. El frontend no envía precios, impuestos ni totales definitivos.

## Folios, transacción y modelos

Formato inicial: `VTA-<sucursal>-<YYYYMMDD UTC>-<consecutivo de al menos 6 dígitos>`; ejemplo `VTA-2-20261119-000001`. El ID de sucursal aparece como parte del identificador legible, nunca como un campo que el cajero deba capturar. Los IDs internos y el UUID del intento siguen siendo conceptos distintos.

`folio_documento` mantiene un contador por empresa, sucursal, tipo y día UTC. `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` incrementa el contador bajo bloqueo transaccional. La restricción existente `uq_venta_sucursal_folio` sigue siendo la garantía final de unicidad. Se omiten folios explícitos históricos que ocupen el mismo formato, con límite de 1000 intentos. No se renumeran documentos existentes. El prefijo y periodo tienen una política fija inicial; no se implementó una pantalla de configuración.

`operacion_venta` almacena empresa, usuario, sucursal, UUID, venta, huella SHA-256 y respuesta original. El bloqueo asesor de transacción serializa solicitudes con la misma empresa/clave antes de comprobar la huella. La huella incluye campos operativos ya validados y excluye IP y UUID. La asignación de folio, venta, efectos existentes y respuesta se realizan en la misma transacción; un error revierte esta unidad. No se promete numeración fiscal sin huecos: documentos explícitos, colisiones y operaciones administrativas pueden influir en la secuencia.

La consulta por clave toma el mismo bloqueo antes de buscar el resultado. Los tiempos de espera o errores mantienen el bloqueo del frontend; no se programan reintentos automáticos de POST. Otra pestaña con una clave distinta representa otra operación: el sistema no intenta deducir que dos carritos iguales son una sola venta.

La infraestructura de contador distingue el tipo de documento para futuras extensiones. Solo `VENTA` se utiliza en esta tanda; compras, pedidos y devoluciones conservan sus contratos actuales.

## Archivos de esta tanda

Rutas relativas a la raíz de POSMYCLETH:

| Área | Archivos nuevos o modificados |
|---|---|
| Persistencia | `apps/api/prisma/schema.prisma`; `apps/api/prisma/migrations/20261119090000_sale_folios_idempotency/migration.sql` |
| Backend ventas | `apps/api/src/modules/sales/sale.schema.ts`, `sale.controller.ts`, `sale.routes.ts`, `types/sales.types.ts`, `services/sale-create.service.ts` |
| Backend nuevo | `apps/api/src/modules/sales/services/create/sale-operation.ts`; `apps/api/src/modules/sales/sale-operation.controller.ts` |
| Frontend POS | `apps/web/src/pages/PosPage.tsx`; `apps/web/src/features/pos/pos.logic.ts`, `submission.guard.ts`, `PaymentEditor.tsx`, `SaleConfirmation.tsx` |
| Componentes nuevos | `apps/web/src/features/products/QuickProductSearch.tsx`; `apps/web/src/features/pos/payment.balance.ts` |
| Reutilización | `apps/web/src/features/commercial/commercial.types.ts`, `commercial.service.ts`, `WarehousePicker.tsx`; `apps/web/src/features/cash/CashSessionPicker.tsx` |
| Pruebas | `apps/api/src/modules/sales/tests/sale-operation.test.ts`; `apps/web/tests/pos-modernization.test.mjs`, `pos-fixture-state.mjs`, `pos-fixture-http.test.mjs` |
| Documentación | Este avance, `docs/frontend/README.md` y referencia desde `operacion-comercial-avance.md` |

Se reutilizan `useMethods`, `useRemoteResource`, `apiRequest`, protección de sesión, `ProductBrowser`, `CustomerBrowser`, `CartEditor`, validaciones y `persistCompletedSale`. El nuevo código de persistencia usa SQL parametrizado con el cliente Prisma existente; no se editaron archivos generados ni compilados del backend.

## Validaciones ejecutadas

- Frontend: `npm run build` y `npm run lint` correctos.
- Backend: `npm run typecheck` correcto, sin generar compilados.
- Prisma: validación del esquema correcta; **no aplica la migración ni comprueba PostgreSQL**.
- Frontend/simulador: 34 pruebas aprobadas: 30 previas y 4 nuevas, incluyendo cinco solicitudes HTTP paralelas con la misma clave y una sola venta conservada en el simulador.
- Backend: 16 pruebas aprobadas: 10 existentes y 6 nuevas de contrato, formato, huella, recuperación/conflicto, omisión de colisiones y persistencia del resultado. Las consultas nuevas se prueban con sustitutos controlados: no se ejecuta SQL en PostgreSQL.
- Navegador: captura de código y SKU con Enter, foco conservado, una línea con cantidad 2, importe pendiente, dos pagos, cambio, selección de caja propia, confirmación, folio generado, listado/detalle con pagos correctos, Escape, resultado incierto y recuperación por GET, siguiente carrito vacío.
- Navegador móvil: ancho de 390 px sin desbordamiento global, confirmación y recuperación visibles. En el flujo normal inicial no hubo errores ni advertencias de consola. El 503 posterior fue deliberado.

Ejemplo normal comprobado antes de reiniciar el simulador: dos unidades, total 232.00, transferencia 100.00, efectivo aplicado 132.00, recibido 200.00 y cambio local 68.00. Después de reiniciar se comprobó una venta de 116.00 con respuesta simulada 503 y recuperación del resultado confirmado.

Las capturas permanecen fuera del repositorio. El simulador conserva exclusivamente datos sintéticos en memoria, fecha de referencia fija 19 de noviembre y política simplificada independiente. Los escenarios `?fixture=uncertain` y `?fixture=network-lost` permiten probar fallos con folio automático. No equivalen a una prueba de concurrencia, bloqueos o integridad de PostgreSQL.

## Plan de despliegue previo a la aplicación y validación operativa pendiente

1. Confirmar que el destino es desarrollo local y revisar las migraciones aplicadas/pendientes. No se ejecutó `migrate deploy`, `migrate dev`, `db push`, reset ni consulta a datos reales.
2. Revisar y autorizar la migración preparada. Crea dos tablas y un índice, y una referencia a `venta`; no modifica folios o ventas existentes. `migrate deploy` puede ejecutar otras migraciones pendientes: se debe comprobar la lista antes de autorizarlo.
3. Aplicar únicamente el cambio aprobado y generar el cliente conforme al procedimiento existente. Publicar/activar el backend compatible antes del frontend automático; el backend anterior rechaza capturas sin folio. Si faltan las tablas nuevas, la operación automática falla y no debe anunciarse como disponible.
4. Validar contratos HTTP con una sesión real y los permisos de cada rol. No introducir credenciales en documentación ni chat.
5. Acordar productos, cliente, almacén, caja, cantidades e importes de ventas controladas y las consecuencias en inventario, caja, auditoría y sincronización antes de registrar. Concurrencia, rollback y recuperación real siguen pendientes.
6. Solo después de validar y aceptar el bloque se cerrará su documentación funcional. No se realizaron staging, commits, push ni PR. Se conservaron cambios previos y los hashes de AGENTS.md/contexto maestro.

## Continuidad autorizada por bloques

| Orden | Módulo | Trabajo posterior |
|---|---|---|
| 1 | Integración real POS | Completar los pasos controlados anteriores. |
| 2 | Devoluciones y cancelaciones | Inspeccionar contratos existentes; buscar venta, seleccionar artículos, reembolsos y consulta de movimientos. |
| 3 | Caja avanzada | Apertura, cierre, arqueos, entradas/salidas e historial según API. |
| 4 | Compras y proveedores | Mantenimiento, registro de compras y recepción. |
| 5 | Inventario avanzado | Ajustes, traspasos, kardex y alertas. |
| 6 | Cotizaciones y pedidos | Crear documentos y convertirlos en ventas según contratos. |
| 7 | Créditos y cuentas por cobrar | Verificar primero soporte real de saldos, vencimientos y abonos; no confundir el método CREDITO con un módulo completo de cobranza. |

Estos bloques son continuidad prevista, no funcionalidades implementadas por esta tanda. Sus operaciones de datos requieren identificar y autorizar los efectos concretos. No se modifica el contexto maestro íntegro para registrar este avance.

## Migración local aplicada — 19 de noviembre de 2026

Tras aprobación específica del desarrollador, se aplicó únicamente `20261119090000_sale_folios_idempotency` en `pos_novnix`, esquema `pos`, `localhost:5432`.

Antes de ejecutarla se repitió la auditoría en una transacción de solo lectura: siete migraciones aplicadas con checksum coincidente, ninguna incompleta ni adicional y solo la migración autorizada pendiente.

Comando ejecutado desde apps/api: `node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma`. Finalizó con código 0 y reportó únicamente esa migración como aplicada. No se ejecutaron reset, db push ni generación del cliente.

La comprobación posterior, también de solo lectura, confirmó ocho migraciones aplicadas con checksum coincidente y ninguna pendiente; tablas folio_documento y operacion_venta; claves primarias compuestas; CHECK ultimo > 0; referencia a venta con ON DELETE RESTRICT; índice idx_operacion_venta_venta. Las dos tablas nuevas tienen cero filas. La restricción uq_venta_sucursal_folio permanece presente.

Esto valida la aplicación de la migración real, **no una venta real ni la concurrencia operativa**. No se invocaron endpoints de negocio ni se registraron ventas, pagos o movimientos de inventario. El siguiente paso sigue siendo revisar la API real y acordar operaciones controladas antes de probar efectos comerciales. Los puntos anteriores de despliegue describen el plan previo; la revisión y aplicación de esta migración ya están completadas. No se ejecutaron staging, commit, push ni PR.

## Consultas reales autenticadas — 19 de noviembre de 2026

El desarrollador inició sesión manualmente en el frontend real de 127.0.0.1:5173. Se utilizó una envoltura temporal de la aplicación real desde código fuente en 127.0.0.1:3000, con lista acotada de GET y bloqueo de mutaciones de negocio. Solo se permitió el POST normal de autenticación realizado por el usuario. No se modificaron las rutas o permisos de producción para esta restricción temporal y no se inició el worker de sincronización.

Resultados observados mediante interfaz y API: health y conexión PostgreSQL 200; ocho rutas de negocio sin sesión rechazadas con 401; consultas autenticadas de productos, almacenes/stock, clientes, métodos, caja/sesión, listado, detalle y resumen financiero correctas. Se observaron un producto activo, un cliente activo, un almacén autorizado y 38 ventas existentes. La búsqueda exacta por código encontró el artículo. La selección automática del único almacén y caja funcionó.

El almacén tiene 1.000 unidades disponibles del artículo Smart Home Speaker, SKU WG-119-A1-A2, precio de catálogo 1135.94 y sin impuestos activos. Se preparó una línea de una unidad sin descuento. La captura fue exclusivamente local: no se confirmó el POST de venta. Efectivo fue rechazado antes del envío porque la sesión abierta pertenece a otro usuario; crédito sin cliente también fue rechazado antes del envío. Transferencia bancaria permitió abrir la revisión por 1135.94, sin cliente, referencia PRUEBA-LOCAL-POS y folio automático pendiente de asignación.

Efectos de una eventual prueba de registro todavía no autorizada: venta, detalle y pago por transferencia; stock disponible de 1 a 0; salida de inventario; auditoría; fila de folio e idempotencia; operación de sincronización pendiente. El worker permanece detenido, pero la operación pendiente podría enviarse al activar posteriormente la sincronización. No se autoriza ni ejecuta esa operación por haber preparado la captura.

Se detectó que los nuevos controles de cobro se estrechaban excesivamente en una ventana intermedia. Se ajustó únicamente la cuadrícula .pos-payment de apps/web/src/pages/CommercialPage.css a una columna. Compilación y lint volvieron a pasar y se verificó visualmente el formulario legible, sin desbordamiento global (documento 950 px, ventana 965 px). No se añadieron pruebas que reproduzcan reglas de CSS.

Limitaciones de esta revisión: las respuestas 403 de dashboard/summary proceden de la lista temporal de rutas permitidas, no de una comprobación fallida del módulo; el dashboard no se validó en esta tanda. El adaptador PostgreSQL emitió un aviso de obsolescencia sobre client.query concurrente; las consultas revisadas terminaron correctamente. No se modificaron dependencias por ese aviso. Las bitácoras temporales contienen método/ruta/estado, sin tokens o cuerpos; al terminar los routers algunas rutas aparecen abreviadas, por lo que no se presentan como trazabilidad completa por endpoint.

La revisión acredita consultas y preparación de la captura con datos reales. Continúan pendientes registro transaccional, concurrencia y recuperación reales. No se ejecutaron ventas, devoluciones, apertura/cierre de caja ni ajustes de inventario. Tampoco staging, commit, push o PR. Las evidencias de la captura y cobro permanecen fuera del repositorio.

## Ciclo real de venta y cancelación — 19 de noviembre de 2026

El desarrollador autorizó registrar la venta preparada y reintegrar el artículo para mantener una unidad disponible en las pruebas. Se eligió cancelación total mediante el endpoint existente; no se mezcló una devolución con una cancelación del mismo documento. Este resultado no constituye la implementación de una interfaz nueva de devoluciones/cancelaciones.

Entorno: pos_novnix local, empresa 1, Sucursal Matriz 1, Almacén Principal 1. Producto Smart Home Speaker (id 1, SKU WG-119-A1-A2), una unidad a 1135.94, sin descuento ni impuestos activos. Transferencia bancaria (método 3), sin cliente ni sesión de caja; referencia PRUEBA-LOCAL-POS. El servidor verificó que stock y precio coincidieran con lo aprobado antes de habilitar el registro. También exigió VENTAS.CANCELAR al usuario antes de permitir la venta, además del permiso de creación que aplica la API normal.

| Paso ejecutado | Resultado comprobado |
|---|---|
| Estado inicial | Cantidad 1.000, reservado 0.000, disponible 1.000. |
| Registro desde el frontend real | POST /sales → 201; venta id 80, folio VTA-1-20261119-000001, estado COMPLETADA, total 1135.94 y un pago. |
| Verificación posterior | Disponible 0.000; una SALIDA de 1.000 (movimiento 521) y una operación de idempotencia. Detalle y resumen financiero HTTP 200. |
| Reintento idéntico por API | Mismo cuerpo y clave → 201 con la misma venta 80; sigue habiendo una sola salida y una sola operación de idempotencia. No se descuenta otra unidad. |
| Cancelación total por API | PATCH /sales/80/cancel → 200; estado CANCELADA, unidades_reintegradas 1; ENTRADA de 1.000 (movimiento 522). |
| Revisión financiera | total_revertido_cancelacion 1135.94; total_neto_venta 0, total_neto_pagos 0 y estado financiero CANCELADA. El pago original se conserva como evidencia. |
| Segunda cancelación | HTTP 409 SALE_CANNOT_BE_CANCELLED; continúa una sola ENTRADA y disponible 1.000. |
| Verificación visual final | Detalle muestra Cancelada y resumen neto cero; Inventario muestra cantidad 1.000, reservado 0.000, disponible 1.000. |

El historial conserva la venta, su pago, salida/entrada y auditoría. No se borraron ni alteraron cantidades directamente para recuperar el stock. No hubo movimientos de efectivo porque el método fue transferencia; tampoco se ejecutaron transferencias bancarias externas: se probó el registro contable local.

Sincronización: quedaron dos operaciones PENDIENTES vinculadas a los movimientos 521/522, ajustes -1/+1, ambas con intentos 0. No se enviaron al E-commerce ni se eliminaron. Su ajuste neto es cero, pero siguen siendo operaciones pendientes que se deben considerar antes de activar el worker. No se hicieron promesas de eliminación automática ni se modificaron sus estados.

El control temporal se limitó a la solicitud exacta autorizada, sus reintentos con la misma clave y la cancelación de la venta resultante. La autorización de la sesión permaneció solo en memoria para ejecutar las comprobaciones de API; no se escribió en archivos ni resultados. Al terminar se cerró ese proceso y se restableció la API de solo consultas en 127.0.0.1:3000, con el worker sin iniciar. El frontend real permanece en 127.0.0.1:5173 y muestra el stock restaurado.

### Regla operativa para cada prueba posterior

1. Verificar antes del caso que el mismo artículo/almacén tiene cantidad 1, reservado 0 y disponible 1. Si el precio, permisos o contexto difieren, revisar el alcance antes de escribir.
2. Ejecutar un caso de venta a la vez y conservar su folio, id y clave de intento. No cambiar la clave para repetir una respuesta incierta; consultar primero el resultado.
3. Si la venta se completó y no tiene devoluciones, utilizar su cancelación autorizada para reintegrar el artículo. Si el caso prueba una devolución, comprobar su reintegro y no cancelar después una venta con devoluciones.
4. Verificar estado, resumen financiero, movimientos y stock final. No iniciar otro caso hasta que disponible sea 1 y no exista un registro incierto. Detenerse ante una discrepancia; no resolverla con UPDATE de existencias, borrados o resets.
5. Mantener detenido el worker durante estas pruebas y revisar las operaciones pendientes antes de cualquier sincronización externa. La autorización de restaurar stock no equivale a autorización para modificar o borrar la cola.

Este ciclo respalda registro real, folio automático, reintento idempotente, cancelación y prevención de doble reintegro. No prueba simultaneidad de primeras solicitudes, todos los roles, ventas con efectivo/crédito ni el flujo de devoluciones; esos casos siguen pendientes. No se ejecutó staging, commit, push ni PR. Capturas de registro, cancelación y stock final se conservaron fuera del repositorio.

## Concurrencia inicial y recuperación — 19 de noviembre de 2026

Se ejecutó un segundo ciclo controlado sobre la misma unidad y contexto ya autorizados. Se comprobó antes cantidad 1.000, reservado 0.000, disponible 1.000 y precio 1135.94. No se amplió el caso a otro producto, método de pago, empresa o almacén.

La envoltura temporal de prueba, fuera del código de producción, retuvo las tres solicitudes POST iniciales con una barrera antes de entregar cualquiera al servicio real. Las tres llevaban el mismo cuerpo, usuario y clave de idempotencia. Dos se enviaron desde el controlador temporal con la misma autorización mantenida exclusivamente en memoria; la primera se inició desde el frontend real. Después de que las tres alcanzaron la barrera se liberaron hacia la aplicación real y PostgreSQL.

Resultado: las tres ejecuciones devolvieron internamente la venta id 81, folio VTA-1-20261119-000002, por 1135.94. Las dos respuestas auxiliares HTTP fueron 201 con ese mismo id/folio. Se comprobó una sola operación de idempotencia, un solo pago y una sola SALIDA de 1.000 (movimiento 523); stock disponible 0.000. La numeración avanzó al segundo folio sin reutilizar el de la venta 80 cancelada.

Para la petición original del navegador, el controlador temporal sustituyó la respuesta exitosa por un HTTP 503 después del registro real. Fue una pérdida de confirmación simulada sobre una transacción PostgreSQL real, no una caída física de red. El frontend mostró el intento pendiente y bloqueó otra captura. «Consultar resultado del intento» ejecutó GET y recuperó la venta 81 con folio e importe confirmados, sin otro POST desde la pantalla.

Después se ejecutó la cancelación autorizada mediante PATCH /sales/81/cancel: HTTP 200, estado CANCELADA y unidades_reintegradas 1. Se comprobó la ENTRADA 524 y stock final cantidad 1.000, reservado 0.000, disponible 1.000. El resumen financiero devolvió total_revertido_cancelacion 1135.94, total_neto_venta 0, total_neto_pagos 0, estado CANCELADA; detalle y resumen devolvieron 200. Se verificaron también cancelación e inventario en la interfaz.

Las sincronizaciones de los movimientos 523/524 quedaron PENDIENTES con ajustes -1/+1 e intentos 0; se conservaron sin envío ni limpieza. Este ciclo añade otro par al que dejó la prueba anterior. El worker no se inició. Se cerró la envoltura de concurrencia, se descartó su autorización temporal en memoria y se restableció el entorno de solo consultas.

La prueba acredita contención de tres primeras solicitudes idénticas, una sola venta y recuperación del resultado por GET con el backend/PostgreSQL reales. No acredita todos los escenarios de carga, bloqueo, reinicio del servidor o corte físico de red. Efectivo, crédito, otros roles y devoluciones siguen pendientes. No hubo cambios de producción en este caso ni staging, commit, push o PR. Evidencias del intento pendiente, recuperación, cancelación y stock final se guardaron fuera del repositorio.

## Devolución total real y protección contra doble reintegro — 19 de noviembre de 2026

Se continuó la autorización del desarrollador para realizar devoluciones/cancelaciones que restablezcan la unidad después de cada prueba. Se conservaron producto, precio, almacén, método por transferencia y condiciones de los ciclos anteriores. La envoltura temporal exigió permisos VENTAS.CREAR, VENTAS.CANCELAR y VENTAS.DEVOLVER antes de permitir la venta y restringió la devolución al cuerpo/documento exactos de esta prueba. El worker permaneció sin iniciar.

| Paso | Resultado real comprobado |
|---|---|
| Venta desde POS | Venta 82, folio VTA-1-20261119-000003, total 1135.94, una unidad por transferencia. |
| Devolución completa por API | POST /sales/82/returns → 201; devolución 20, folio DEV-QA-VTA-1-20261119-000003, total 1135.94, cantidad 1. |
| Reembolso registrado | Una fila por 1135.94 asociada al pago original 61, método TRANSFERENCIA. No se ejecutó una transferencia bancaria externa. |
| Consultas de devolución | Listado y detalle por GET devolvieron 200. |
| Inventario | SALIDA 525 de 1.000 por VENTA y ENTRADA 526 de 1.000 por DEVOLUCION_VENTA; cantidad 1.000, reservado 0.000, disponible 1.000 al terminar. |
| Resultado financiero | total_devuelto 1135.94; total_revertido_cancelacion 0; total_neto_venta 0; total_neto_pagos 0; estado DEVUELTA_TOTAL. |
| Repetir la devolución | HTTP 409 RETURN_QUANTITY_EXCEEDED: ya no quedan unidades devolvibles; stock sigue en 1.000. |
| Cancelar después de devolver | HTTP 409 SALE_HAS_RETURNS; no se crea una segunda entrada y stock sigue en 1.000. |

La verificación de PostgreSQL se hizo en una transacción de solo lectura: una devolución, un reembolso y exactamente los dos movimientos vinculados al caso. Ambas sincronizaciones nuevas están PENDIENTES, ajustes -1/+1 e intentos 0; no se enviaron ni eliminaron. No se alteraron existencias con SQL, no se borró historial y no se reinició la base de datos.

La venta conserva estado documental COMPLETADA, conforme al contrato actual: la devolución no la transforma en CANCELADA. Su resumen financiero sí muestra DEVUELTA_TOTAL y netos cero. La pantalla Pagos y devoluciones mostró una devolución por 1135.94, devolución total y netos 0.00; Inventario mostró la unidad restaurada. Esa diferenciación evita confundir estado del documento original, devolución y cancelación.

Se probó la devolución usando el endpoint real existente y su consulta visual; no se creó todavía un formulario frontend para registrar devoluciones. No se probó devolución parcial, efectivo, crédito, otros roles o carga concurrente de devoluciones en este caso. Al terminar se cerró el controlador temporal, se descartó la autorización de memoria y se restableció la API de solo consultas, con worker detenido.

Se conservaron fuera del repositorio las capturas del resumen de devolución total y stock final. El código de producción no cambió durante este caso; únicamente se actualiza este avance y el índice. No se ejecutaron staging, commit, push ni PR.

## Continuidad: formulario frontend de devoluciones y cancelaciones

El formulario, historial, confirmación y protección de resultados inciertos se implementaron después de las pruebas de API anteriores. Su alcance, archivos y resultados están en [Devoluciones y cancelaciones](devoluciones-cancelaciones-avance.md). Esta nueva tanda no ejecutó escrituras reales; conserva las pruebas anteriores como evidencia separada.
