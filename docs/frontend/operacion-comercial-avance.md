# Bloque A — Operación comercial del frontend

Fecha de comprobación: 16 de noviembre de 2026.

Estado: IMPLEMENTADO y VALIDADO EN AISLAMIENTO. Pendientes la revisión del desarrollador y la validación de integración con el entorno real. Este documento registra el avance comprobado; no declara el cierre funcional de los módulos.

## Objetivo y alcance

Preparar una venta desde productos y cliente hasta su confirmación, reutilizando la autenticación, el layout, la navegación y el cliente HTTP existentes. Se inspeccionaron los contratos actuales de `apps/api` sin modificar el backend ni consultar la base de datos.

| Pantalla | Ruta | Comportamiento implementado |
|---|---|---|
| Productos | `/products` | Búsqueda por nombre, SKU o código de barras, estado, precios, impuestos activos, paginación y consulta de existencias |
| Inventario | `/inventory` | Selección de almacén autorizado y consulta de cantidad, reservado, disponible y situación de existencias |
| Clientes | `/customers` | Búsqueda por nombre, código, RFC, correo o teléfono; datos comerciales, estado y paginación |
| Punto de venta | `/pos` | Artículos, cantidades, descuentos, cliente, almacén/sucursal, pagos, sesión de caja y confirmación de registro |
| Caja | `/cash` | Cajas asignadas y consulta de su sesión abierta; funciona con `CAJAS.VER` sin depender de inventario |

No se implementaron creación/edición de clientes o productos, apertura/cierre de caja, movimientos manuales, devoluciones, impresión, facturación ni abonos de cuentas por cobrar. La interfaz de clientes reutilizable se concentra en búsqueda y selección para la captura. Estas ampliaciones quedan para tandas posteriores.

## Contratos inspeccionados y utilizados

Todas las rutas de esta tabla llevan el prefijo `/api/v1`.

| Método y ruta | Permiso | Uso |
|---|---|---|
| `GET /products` | `PRODUCTOS.VER` | `search`, `activo`, `page`, `limit`; la búsqueda del servidor incluye nombre, SKU y código |
| `GET /inventory/warehouses` | `INVENTARIO.VER` | Almacenes activos accesibles al usuario; paginación de 100 registros |
| `GET /inventory/stock` | `INVENTARIO.VER` | `almacen_id`, `search`, `producto_id` opcional, `activo=true`, `page`, `limit` |
| `GET /customers` | `CLIENTES.VER` | `q`, `activo`, `page`, `pageSize` |
| `GET /payment-methods` | Autenticación | Métodos activos, `page`, `pageSize`; sin asumir IDs fijos |
| `GET /cash` | `CAJAS.VER` | Cajas asignadas; `sucursal_id` opcional, `page`, `pageSize` |
| `GET /cash/:cashId/sessions/current` | `CAJAS.VER` | Sesión abierta o `null` |
| `POST /sales` | `VENTAS.CREAR` | Registro de venta mediante el contrato real existente |
| `GET /sales`, `GET /sales/:id` | `VENTAS.VER` | Integración con el listado y el detalle previos, sin cambiar sus contratos |

Las respuestas superiores `{ok,data,pagination}` y anidadas `{ok,data:{items,total,page,pageSize}}` se adaptan explícitamente al formato común del frontend. Los catálogos de almacenes, métodos y cajas conservan paginación; no se presupone que la primera página contiene todos los registros.

Referencias de backend: rutas y schemas de `products`, `customers`, `inventory`, `cash`, `payment-methods`, `sales`; serializadores correspondientes y preparadores de detalle/pagos de venta. Las cantidades e impuestos del carrito se basan en esos archivos vigentes.

## Arquitectura y archivos

Archivos nuevos de producción:

- `apps/web/src/hooks/useRemoteResource.ts`: extracción del hook ya usado en ventas; conserva cancelación, clave por sesión, manejo de 401/403/404 y protección contra respuestas obsoletas.
- `apps/web/src/features/commercial/commercial.types.ts`: contratos de consulta, captura y respuesta.
- `apps/web/src/features/commercial/commercial.service.ts`: solicitudes y validación de respuestas.
- `apps/web/src/features/commercial/commercial.hooks.ts`: consultas y permisos.
- `apps/web/src/features/commercial/SearchForm.tsx`: formulario de búsqueda compartido.
- `apps/web/src/features/commercial/Pagination.tsx`: paginación común.
- `apps/web/src/features/commercial/QueryFeedback.tsx`: carga, error y reintento de consultas.
- `apps/web/src/features/commercial/WarehousePicker.tsx`: selección de almacén y sucursal.
- `apps/web/src/features/products/ProductBrowser.tsx`: catálogo reutilizado en productos y POS.
- `apps/web/src/features/customers/CustomerBrowser.tsx`: consulta y selección de cliente.
- `apps/web/src/features/inventory/StockBrowser.tsx`: existencias consultadas al servidor.
- `apps/web/src/features/cash/CashSessionPicker.tsx`: caja/sesión actual y selección de sesión propia.
- `apps/web/src/features/pos/pos.draft.ts`: borrador de captura en memoria, aislado por sesión.
- `apps/web/src/features/pos/usePosDraft.ts`: conservación del borrador entre rutas y limpieza al cerrar sesión.
- `apps/web/src/features/pos/DiscardConfirmation.tsx`: confirmación accesible de descarte.
- `apps/web/src/features/pos/pos.logic.ts`: validaciones, estimación y solicitud de venta.
- `apps/web/src/features/pos/submission.guard.ts`: protección local de intentos pendientes.
- `apps/web/src/features/pos/CartEditor.tsx`: cantidades, descuentos, eliminación y consulta de disponible.
- `apps/web/src/features/pos/PaymentEditor.tsx`: pagos divididos y sus referencias.
- `apps/web/src/features/pos/SaleConfirmation.tsx`: diálogo nativo accesible.
- `apps/web/src/pages/PosPage.tsx`: coordinación de captura y registro.
- `apps/web/src/pages/CommercialPages.tsx`: pantallas de consulta.
- `apps/web/src/pages/CommercialPage.css`: presentación responsiva.

Archivos nuevos de prueba:

- `apps/web/tests/pos-logic.test.mjs`: once pruebas aisladas de captura y protección del intento.
- `apps/web/tests/pos-fixture-state.mjs`: datos, cálculo decimal independiente y operaciones del simulador en memoria.
- `apps/web/tests/pos-fixture-http.test.mjs`: nueve pruebas HTTP contra el simulador aislado en puerto temporal.
- `apps/web/tests/pos-draft.test.mjs`: tres pruebas de conservación, aislamiento y protección ante registros dañados.
- `apps/web/tests/pos-browser-fixture.mjs`: servidor de interfaz con API simulada; no importa el backend ni configura proxy.

Archivos existentes modificados:

- `apps/web/src/app/router/AppRouter.tsx`: cinco rutas protegidas por sesión.
- `apps/web/src/app/navigation/navigation.config.ts`: enlaces visibles por permiso.
- `apps/web/src/features/sales/useSales.ts`: reutilización del hook extraído, conservando las consultas previas.
- `apps/web/src/pages/SalesPage.tsx`: enlace «Nueva venta» para usuarios autorizados.
- `docs/frontend/README.md`: enlace a este registro de avance.

Se reutilizan `apiRequest`, `ApiHttpError`, `useAuthSession`, `DashboardLayout`, estilos de ventas y `isSaleId`. No se instalaron dependencias ni se modificaron manifiestos o archivos de bloqueo.

## Flujo de captura

1. Entrar a Punto de venta con `VENTAS.CREAR` y permisos de consulta de productos e inventario.
2. Elegir un almacén activo devuelto por la API. La sucursal se obtiene del propio almacén.
3. Indicar el folio, buscar productos y agregarlos al carrito. Repetir un producto aumenta una línea, conservando el descuento.
4. Ajustar cantidades y descuentos, revisar el disponible y seleccionar cliente si corresponde.
5. Agregar uno o varios pagos con métodos reales y referencias opcionales.
6. Para efectivo, consultar una caja y seleccionar explícitamente una sesión abierta por el mismo usuario y perteneciente a la sucursal de la venta.
7. Pulsar «Revisar y registrar venta», revisar el diálogo y confirmar expresamente.
8. Mostrar el resultado confirmado por la API; permitir el acceso al detalle existente cuando el usuario tenga `VENTAS.VER`.

## Importes y validación

Los importes anteriores al registro son **estimaciones**. Se reproduce la secuencia inspeccionada de `sale-detail.preparer.ts`, `sale-totals.ts` y `sale-money.ts`: redondeo por línea, descuento, base gravable, suma de tasas activas e impuesto. No existe un endpoint de previsualización de venta en las rutas inspeccionadas.

La solicitud envía identificadores, cantidades, descuentos y pagos; no envía precios, tasas, subtotal, impuesto, total ni identidad de usuario. El backend vuelve a leer los registros y decide el resultado definitivo. Un cambio de precios o impuestos puede invalidar el pago estimado y requiere revisar la captura.

Validaciones implementadas:

- Identificadores BIGINT como strings, sin conversión a `number`.
- Productos y almacén de la empresa de la sesión; almacén y sucursal activos.
- Cantidad positiva con hasta tres decimales dentro del rango de almacenamiento. Productos con inventario o unidad sin fracciones exigen enteros, conforme al preparador de venta actual.
- Descuento entre 0 y 100 con hasta cuatro decimales; límites de importes y precisión.
- Folio no vacío de hasta 50 caracteres; el servidor verifica su unicidad por sucursal.
- Métodos activos, pagos positivos con hasta dos decimales y suma exacta en centavos igual al estimado. La operación no calcula cambio ni acepta un importe recibido superior como si fuera el pago aplicado.
- Crédito determinado por el método cuyo código es `CREDITO`; requiere cliente activo. No se interpreta el límite configurado como saldo disponible ni como abono de cobranza.
- Efectivo condicionado a una sesión propia, abierta y de la sucursal seleccionada. Cambiar de sucursal invalida la selección anterior.
- La consulta de existencias es informativa: no reserva stock. El servidor aplica la comprobación transaccional definitiva y puede rechazar una operación concurrente.

## Seguridad, errores y prevención de duplicados

Las consultas usan JWT y `AbortController`. Un 401 limpia solo la sesión que corresponde al token de esa solicitud; un 403 presenta acceso restringido. Las respuestas inválidas no se incorporan como datos válidos a la pantalla.

El envío de venta exige confirmación y establece un bloqueo síncrono antes de iniciar la solicitud; el resto de la captura queda deshabilitado mientras se espera respuesta. El frontend no programa reintentos de POST. El navegador puede repetir el transporte cuando se corta una conexión: en esa situación el folio y la comprobación del resultado siguen siendo necesarios; el bloqueo visual no equivale a idempotencia del servidor.

Antes del envío se guarda en `sessionStorage` únicamente empresa, sucursal y folio del intento. No se guardan credenciales adicionales, cliente ni carrito en ese registro. Si no se puede guardar la protección, no se envía la venta.

Los rechazos HTTP definitivos inferiores a 500, salvo 408/409, permiten corregir conservando el carrito. Una respuesta perdida, no interpretable, 408, 409 o 5xx bloquea otra captura y solicita revisar el folio en su sucursal. Para liberar el bloqueo se requiere declarar explícitamente que se comprobó el resultado. Esto es una protección de interfaz, no una garantía de idempotencia del servidor.

La marca del intento pertenece a esta pestaña y su sesión de navegador: no coordina otras pestañas o equipos. El borrador ahora se conserva en memoria entre las rutas de la aplicación: almacén, cliente, folio, observaciones, artículos, pagos y métodos seleccionados. Está aislado por empresa, usuario y sesión; se limpia al cerrar sesión, confirmar una venta o descartar expresamente la captura. Al volver a la captura, se debe verificar y seleccionar de nuevo la sesión de caja para efectivo. El borrador no sobrevive una recarga completa o el cierre de la pestaña; la protección de un intento pendiente sí se conserva en sessionStorage. No cerrar ni abandonar una captura durante el registro.

Registrar una venta real puede modificar ventas, inventario, caja, auditoría y sincronización. Ninguna prueba de esta tanda ejecutó esas operaciones en el backend real.

## Validación ejecutada

Comandos desde `apps/web`:

```bash
npm run build
npm run lint
node --test tests/sales-query.test.mjs tests/pos-logic.test.mjs tests/pos-draft.test.mjs tests/pos-fixture-http.test.mjs
```

Resultados finales: compilación TypeScript/Vite correcta, ESLint correcto y **30 pruebas aprobadas, 0 fallidas**: siete de consultas de ventas, once de lógica POS, nueve HTTP del simulador y tres de borrador/protección.

La prueba de navegador ejecutó el frontend real contra un servidor simulado sin conexión al backend. Se comprobaron:

- Búsqueda de producto por SKU, paginación de catálogo y consulta de stock por almacén.
- Consulta de clientes, selección para crédito, consulta de caja y sesión actual.
- Cantidades enteras requeridas, crédito sin cliente y efectivo sin sesión.
- Invalidación de sesión por cambio de sucursal y bloqueo de sesión abierta por otro usuario.
- Confirmación, Escape y registro simulado de crédito; un doble clic produjo una sola solicitud para ese folio.
- Rechazo simulado 422 por stock: mensaje y carrito conservado.
- Respuesta simulada 503: bloqueo del intento; salir y volver a la pantalla recuperó la marca pendiente.
- Estados vacío, 403, respuesta incompleta, falta de permiso y 401 con retorno al login.
- Enlace desde Ventas a Nueva venta.
- Consulta independiente de caja con un usuario que solo tiene `CAJAS.VER`.
- Escritorio y móvil de 390 px; se detectó y corrigió un desbordamiento debido a las etiquetas accesibles de los botones. El ancho del documento móvil quedó igual al ancho útil de la pantalla.

La validación se amplió a operaciones conservadas en memoria: el simulador calcula los importes según sus datos de prueba, valida pagos y stock, devuelve conflictos de folio y permite consultar listado, detalle y resumen después de registrar. También simula una venta confirmada cuyo transporte se interrumpe. Este modelo no importa ni ejecuta los servicios del backend real. Los datos fueron sintéticos y no salieron hacia `apps/api`. La validación de navegación no sustituye una prueba HTTP contra PostgreSQL ni una revisión de todos los roles reales. No se declara comprobada una venta real.

Correcciones durante la comprobación: cierre de etiqueta del carrito, altura del catálogo POS, ancho móvil y eliminación de la dependencia de inventario en la consulta independiente de caja. La versión final volvió a superar compilación, ESLint y pruebas.

## Cómo repetir la revisión sin datos reales

Desde Git Bash:

```bash
cd ~/Documentos/POSMYCLETH/apps/web
node tests/pos-browser-fixture.mjs
```

Abrir `http://127.0.0.1:5174/pos`. El servidor de prueba utiliza sesión y datos simulados exclusivamente en ese origen. No usarlo como servicio de producción. Escribir `stop` en su terminal para detenerlo; `stats` muestra los contadores del simulador.

Escenarios de consulta disponibles mediante `?fixture=empty`, `forbidden`, `malformed`, `no-permission`, `expired`, `cash-other`, `cash-closed`, `cash-none`, `cash-only`, `financial-error`, `no-customers` o `no-inventory`. El folio `REJECT` simula un rechazo 422 sin registro; `UNCERTAIN` registra en memoria y responde 503; `NETWORK-LOST` registra y corta la conexión; `MALFORMED` registra y devuelve una respuesta incompleta. Reiniciar el simulador elimina sus ventas y restablece las existencias de prueba. Esos comportamientos pertenecen al fixture y no al frontend de producción.

## Validación ampliada solicitada por el desarrollador

El 16 de noviembre de 2026 se ejecutaron **48 comprobaciones de navegador**, además de las 30 pruebas automáticas. Se utilizaron el frontend real y el servidor de prueba, sin conexión al backend ni a PostgreSQL.

| Grupo | Resultado comprobado |
|---|---|
| Venta mixta | Tres unidades con descuento del 10%, servicio de 1.25 horas, transferencia de 100.00 y efectivo de 275.70; total 375.70 |
| Consulta posterior | Folio localizado una sola vez, artículos y pagos correctos, resumen financiero y stock disponible de 97 unidades después de vender tres |
| Crédito | Rechazo sin cliente y registro con cliente activo; crédito de 116.00 consultable en detalle |
| Rechazo operativo | Cantidad superior al stock devuelve 422 y conserva el carrito para corregir |
| Resultado incierto | 503 después del registro, pérdida de conexión y respuesta incompleta bloquean nueva captura; el folio permite localizar una sola venta |
| Conflicto | Un folio existente devuelve 409 y obliga a revisar el documento |
| Borrador | Carrito, folio y pago sobreviven al cambio de ruta; un nuevo pago conserva un identificador distinto; el descarte requiere confirmación |
| Caja | Sesiones ajenas, cerradas o inexistentes no se pueden usar; la consulta de caja funciona con su permiso independiente |
| Búsquedas | Paginación, productos inactivos, búsqueda por código y prevalencia de la consulta más reciente frente a una consulta lenta |
| Errores | Vacío, 401, 403, respuesta inválida, falta de permiso y detalle 404 con mensajes comprensibles |
| Accesibilidad y tamaños | Confirmación y Escape, menú móvil, escritorio de 1280 px, tableta de 850 px y móvil de 390 px sin desbordamiento global |
| Fallo parcial | Resumen financiero 500 sin ocultar el documento ni sus pagos originales |
| Regresión final | Dos unidades con descuento del 5%, transferencia de 100.00 y efectivo de 120.40; total confirmado 220.40 y siguiente captura vacía |

Se detectó y corrigió la pérdida silenciosa del borrador al navegar. La restauración de pagos ahora evita repetir sus claves y conserva los métodos previamente elegidos. La sesión de caja se vuelve a seleccionar después de regresar al POS. Se incorporó un diálogo HTML de descarte para evitar el bloqueo del aviso nativo en el navegador integrado. También se corrigió el tratamiento de un registro de intento estructuralmente incompleto: conserva el bloqueo en lugar de permitir otro envío.

El doble clic de confirmación produjo un único registro de la venta. Durante el caso de corte de conexión se observó que el navegador podía repetir la petición de transporte; el simulador devolvió conflicto para el mismo folio y mantuvo una sola venta. No se atribuye esta garantía al bloqueo del frontend ni se declara probada idempotencia del backend.

Las evidencias de navegador se conservaron fuera del repositorio: resultados de las 48 comprobaciones, confirmación móvil, venta confirmada y detalle en escritorio/móvil. En el flujo normal final no se registraron errores ni advertencias de consola. Los fallos HTTP deliberados pertenecen a sus escenarios de prueba.

Archivos modificados durante esta ampliación: src/pages/PosPage.tsx, src/features/pos/PaymentEditor.tsx, src/features/pos/submission.guard.ts y tests/pos-browser-fixture.mjs, bajo apps/web, además de este registro. Los seis archivos nuevos se incluyen en las listas de arquitectura y pruebas anteriores. No se instalaron dependencias ni se modificó el backend. Se repitieron compilación, ESLint y las 30 pruebas con resultado correcto.

## Pendientes y siguiente tanda

1. Revisar las pantallas con el desarrollador y validar consultas autorizadas contra la API existente, sin ventas reales de prueba.
2. Acordar la prueba operativa de registro en un entorno controlado si se desea comprobar la transacción completa; requiere autorización aparte y no se ejecutó en esta tanda.
3. Valorar persistencia del borrador entre recargas si se necesita y ampliar comprobaciones de cambios concurrentes de precio y grupos de permisos reales. La navegación interna y los pagos combinados ya se comprobaron con el simulador.
4. Después de la revisión y confirmación de cierre, convertir este avance en documentación final de los módulos que se acepten.
5. Ampliar mantenimiento de clientes/productos o gestión de caja en bloques posteriores, inspeccionando sus contratos y efectos antes de implementarlos.

## Git y conservación de contexto

Base local inspeccionada: rama `devalex`, commit `d26cc19`. No se ejecutó fetch para verificar el estado remoto.

No se realizó staging, commit, push, merge ni PR. Los cambios previos de backend y archivos ajenos permanecen fuera de esta tanda. `AGENTS.md` y el contexto maestro v1.1 no se modifican ni forman parte de una futura publicación de este bloque.

Las capturas de revisión se conservaron fuera del repositorio. Este registro sirve como evidencia técnica de actividades y resultados comprobados; no sustituye el informe académico ni atribuye trabajos anteriores al residente.

## Continuidad del 19 de noviembre de 2026

La automatización de folios, captura rápida, cobro y recuperación de intentos se registra en [POS: modernización](pos-modernizacion-avance.md). Ese documento distingue la implementación nueva, las pruebas aisladas y la migración todavía sin aplicar. Los resultados históricos anteriores se conservan.
