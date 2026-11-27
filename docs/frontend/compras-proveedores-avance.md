# Frontend — Compras y proveedores: avance

Fecha: 22 de noviembre de 2026, America/Mexico_City.

Estado: **IMPLEMENTADO Y VALIDADO EN AISLAMIENTO. INTEGRACIÓN REAL Y CIERRE DEL DESARROLLADOR PENDIENTES.**

## Alcance

Se activaron Compras y Proveedores en el menú existente, con rutas `/purchases`, `/purchases/new`, `/purchases/:purchaseId` y `/suppliers`. Compras incorpora listado paginado, filtros por estado/proveedor, detalle, captura de borrador, recepción completa, pagos parciales o totales y cancelación. Proveedores incorpora búsqueda, estado activo/inactivo, detalle, contactos, días de crédito configurados y domicilios de consulta.

Se reutilizan autenticación, autorización, layout, cliente HTTP, recursos remotos, paginación, búsqueda, captura rápida por código/F2, catálogo de productos, selector de almacén y selector de sesión propia de caja. No se instalaron dependencias ni se modificaron backend, migraciones, permisos o datos reales.

Esta entrega no incluye altas/edición de proveedores, edición de compras ya guardadas, recepción parcial, reversión de pagos, devoluciones al proveedor, folios automáticos de compra, cuentas por pagar ni envíos bancarios. La API inspeccionada no ofrece edición de compras ni recepción parcial. El folio de compra es obligatorio; no se inventó un generador local que aparentara garantizar su unicidad.

## Flujo del operador

1. En Nueva compra se seleccionan almacén/sucursal y proveedor activos de la empresa. La pantalla requiere permisos de consulta de inventario, proveedores y productos, además de crear/ver compras.
2. Se captura folio, factura opcional y observaciones. Los productos se agregan por catálogo o código exacto. Repetir un producto aumenta su cantidad sin duplicar la línea.
3. Se captura explícitamente el costo unitario de compra, cantidad, descuento e impuesto. El precio de venta del catálogo no se usa como costo de compra. El costo puede ser cero cuando se capture expresamente; un campo vacío no equivale a cero.
4. Se revisa y confirma el borrador. Crear el borrador no recibe mercancía ni registra pagos.
5. Desde el detalle se revisa y confirma la recepción completa de todos los artículos. El backend controla existencias, costo promedio, auditoría y eventos de sincronización.
6. Una compra RECIBIDA admite pagos hasta cubrir su saldo. El efectivo requiere una sesión propia abierta y activa de la sucursal correspondiente. La API confirma que existe efectivo suficiente. Los demás métodos no envían sesión de caja.
7. La cancelación exige permiso, motivo y ausencia de pagos. Si la compra se recibió, el backend comprueba existencias para revertirla. Los importes y el saldo de un documento cancelado se conservan como historial y no habilitan pagos.

El borrador local se conserva en memoria al navegar por la aplicación, separado por empresa/usuario, y se limpia al cerrar sesión o confirmar su creación. No sobrevive a una recarga completa. Con artículos capturados se muestra el aviso normal de abandono del navegador antes de recargar; también existe descarte explícito con confirmación. Los intentos enviados tienen una protección persistente independiente.

## Contratos actuales

Todas las rutas utilizan `/api/v1`, autenticación existente e identificadores BIGINT como cadenas.

| Acción | Endpoint | Permiso |
| --- | --- | --- |
| Listar compras | GET `/purchases` | `COMPRAS.VER` |
| Detalle | GET `/purchases/:id` | `COMPRAS.VER` |
| Crear borrador | POST `/purchases` | `COMPRAS.CREAR` |
| Recibir todo | POST `/purchases/:id/receive` | `COMPRAS.CREAR` |
| Registrar pago | POST `/purchases/:id/payments` | `COMPRAS.CREAR` |
| Cancelar | POST `/purchases/:id/cancel` | `COMPRAS.CANCELAR` |
| Buscar proveedores | GET `/suppliers` | `PROVEEDORES.VER` |
| Detalle y domicilios | GET `/suppliers/:supplierId` | `PROVEEDORES.VER` |

El listado de compras usa `estado`, `proveedor_id`, `page` y `pageSize=20`; la API también admite sucursal, que no se expone como filtro adicional en esta entrega. Los filtros/página se conservan en la URL al pasar al detalle y regresar. No se envían filtros de folio o fechas que la API no admite. Proveedores utiliza `q`, `activo`, `page`, `pageSize`.

Los listados responden `{ok:true,data:{items,total,page,pageSize}}`. El detalle responde `{ok:true,data:compra}`. Las mutaciones tienen una capa adicional: `{ok:true,data:{replayed:boolean,data:compra}}`; no se trataron como si devolvieran directamente el documento.

Crear envía sucursal, almacén, proveedor, folio, factura/observaciones y detalles. El servidor obtiene empresa/usuario de la sesión. Recibir envía `{}`; cancelar, `{motivo}`; pagar, método, sesión o `null`, monto y referencia o `null`. No se envían totales calculados desde la interfaz.

## Importes y validación

Se conserva la precisión de cantidades a tres decimales, costos y porcentajes a cuatro y pagos/importes a dos. Se rechazan vacíos, exponentes, signos negativos y separadores de miles. Se respetan los límites de DECIMAL(14, escala), cien líneas y porcentajes entre 0 y 100. Los productos inventariables requieren unidades enteras, código de barras y cantidad compatible con la regla Ecommerce; los servicios pueden ser fraccionarios cuando su unidad lo permite.

El estimador utiliza BigInt para valores escalados y reproduce el orden del trigger inspeccionado: subtotal redondeado por línea, descuento redondeado sobre el subtotal, impuesto sobre la base descontada y suma final. La API conserva la autoridad sobre los importes definitivos.

Los parsers validan forma, identificadores, relaciones compra/proveedor/almacén/sucursal, fechas, estados, detalles y pagos sin duplicados, importes por línea y totales. El saldo se comprueba contra los pagos. La respuesta de creación se compara con el contenido solicitado; una compra consistente pero de otra solicitud no basta para confirmar el intento.

## Idempotencia y respuestas inciertas

El cliente HTTP compartido añade una opción `idempotencyKey` que solo incorpora `Idempotency-Key` cuando se proporciona una UUID válida. Las llamadas existentes mantienen sus cabeceras y comportamiento. Cada nueva acción de compra genera una clave propia.

Antes del POST se guarda en `sessionStorage`, bajo `posmycleth.purchase.pending.v1`, el ámbito empresa/usuario, clave, acción y cuerpo normalizado. No se guardan credenciales o tokens. El fallo de almacenamiento impide enviar. Un registro dañado bloquea nuevas operaciones. El envío y el reintento tienen bloqueo síncrono contra doble clic; las respuestas de una sesión anterior no modifican la nueva identidad.

Una respuesta de red incierta, 408, 409, 5xx, 2xx incompleto o datos incompatibles conserva la protección al recargar o navegar. No hay reintentos automáticos. El operador puede confirmar el reintento con la misma clave y el mismo cuerpo. Se explica que ese POST devuelve el resultado anterior si ya se guardó o puede completar la operación si la primera solicitud nunca llegó: no se presenta como una consulta GET.

El repositorio backend inspeccionado usa un bloqueo transaccional por empresa/clave, hash de usuario/acción/contenido y respuesta persistida. La prueba aislada valida el contrato de replay y su consumo por el frontend; no demuestra la concurrencia real de PostgreSQL. No existe en estas rutas un endpoint de consulta de operaciones por clave. Una liberación manual exige revisión expresa; no prueba que una solicitud anterior haya terminado. El intento de otra identidad no se puede recuperar con el usuario actual.

## Organización del código

- `apps/web/src/features/purchases/`: tipos, validación y centavos escalados, parser, servicio, captura en memoria, hook de envío, protección pendiente, formulario y detalle.
- `apps/web/src/features/suppliers/`: tipos, validación, servicio y buscador/detalle reutilizable en la captura y los filtros.
- `apps/web/src/pages/PurchasesPage.tsx`, `SuppliersPage.tsx`: páginas del módulo.
- `apps/web/src/app/router/AppRouter.tsx`, `apps/web/src/app/navigation/navigation.config.ts`: integración en rutas/menú con los permisos actuales.
- `apps/web/src/services/api.ts`: cabecera opcional de idempotencia, conservando el cliente existente.
- `apps/web/tests/purchase.test.mjs`, `purchase-fixture-state.mjs`, `purchase-browser-fixture.mjs`: pruebas y simulador sin PostgreSQL.

## Validaciones ejecutadas

- TypeScript y build Vite correctos, 173 módulos.
- ESLint correcto.
- Batería frontend: **74 pruebas correctas, 0 fallidas**, incluidas 14 nuevas de Compras/proveedores. Cubren importes, límites, contexto, unidades, borrador, respuestas malformadas, BIGINT, claves/replay, HTTP aislado, permisos, recepción, pagos y cancelación.

Pruebas en navegador sobre `http://127.0.0.1:5182`:

| Caso | Resultado comprobado |
| --- | --- |
| Crear COMPRA-UI-001 | Dos unidades a costo 100 e impuesto 16%; subtotal 200, impuesto 32, total 232; BORRADOR |
| Conservar captura | Folio y costo se mantuvieron al salir a Proveedores y volver a Nueva compra |
| Proveedor | Datos, contacto y domicilio fiscal consultados desde la pantalla |
| Recibir y pagar | RECIBIDA; transferencia 100 y efectivo 132; total pagado 232, saldo 0; una salida simulada de caja de 132 |
| Límites de pago | Pago 233 rechazado antes de enviar; cancelar ausente tras el primer pago; nuevo pago ausente con saldo 0 |
| Recepción y cancelación sin pagos | Una ENTRADA de dos unidades y una SALIDA de dos; stock del caso restaurado de 12 a su inicial 10 |
| Respuesta 503 después de crear/recibir/pagar/cancelar | Bloqueo, recarga, confirmación de reintento con la misma clave y un único efecto por operación |
| Paginación | 23 compras; segunda página con tres registros; estado BORRADOR y página 2 conservados al entrar al detalle y regresar |
| Solo consulta y acceso denegado | Sin Nueva compra; ruta nueva rechazada al usuario de consulta; proveedor/compras sin permiso muestran el error correspondiente |
| Datos malformados | Proveedor o detalle de compra inválidos muestran error; el detalle inválido no habilita mutaciones |
| Inventario insuficiente | Cancelación rechazada con 409, sin operación ni movimientos; la protección se liberó manualmente tras revisar ese caso aislado |
| Efectivo en sesión ajena | El selector no ofreció una sesión utilizable y el formulario impidió llegar a la confirmación del pago |
| Móvil 390 × 844 | Confirmación legible; ancho del documento 390, sin desbordamiento global; viewport restablecido |

Los contadores del simulador confirmaron dos solicitudes y una sola clave para cada caso de respuesta perdida. El caso de pago recuperado terminó con un pago; el de creación, con una compra; recepción/cancelación, con sus movimientos únicos. El caso normal conservó dos pagos distintos con claves distintas, como corresponde. La pestaña nueva de revisión terminó sin errores ni advertencias de consola; los HTTP 503/409 de sus escenarios son deliberados.

El simulador emplea datos y contadores en memoria. Su aritmética es independiente del estimador frontend y no importa Prisma, la API real ni `.env`; no configura proxy. El inventario de estos casos se comprueba en sus contadores, no en el fixture independiente de la pantalla Inventario. No demuestra procedimientos SQL, costo promedio, auditoría, outbox ni exclusión transaccional reales. El ejemplo completo dejó la compra pagada en el simulador para revisión; no corresponde al producto real cuya unidad se conserva para pruebas.

Las evidencias `compras-pagos-simulados.jpg`, `compras-recepcion-movil.jpg` y los resultados sintéticos se guardaron fuera del repositorio. Los documentos y capturas muestran fechas UTC del 23 de noviembre durante la noche local del 22; no se cambió el reloj del sistema.

## Revisión manual aislada

```powershell
cd C:\Users\taiga\Documentos\POSMYCLETH\apps\web
node tests/purchase-browser-fixture.mjs
```

Abrir `http://127.0.0.1:5182/purchases` o `/suppliers`. En Nueva compra seleccionar Sucursal 1 / Almacén 1, proveedor PROV-QA y artículo P-001 por código `750001`; capturar el costo y, si corresponde, impuesto 16. El simulador admite ese artículo y el servicio SERV-001; los demás productos del catálogo base no forman parte de este oráculo de compras.

El comando `stop` cierra el proceso. Reiniciarlo restablece únicamente sus datos en memoria. Los escenarios se eligen mediante `?fixture=fault-create`, `fault-receive`, `fault-pay`, `fault-cancel`, `read-only`, `no-permission`, `no-suppliers`, `supplier-malformed`, `purchase-malformed`, `stock-insufficient`, `cash-other` o `paged`. Cada escenario tiene datos independientes. GET `/__qa/purchases` expone exclusivamente contadores, claves y solicitudes sintéticas de prueba.

## Pendientes y estado de Git

Antes de probar contra PostgreSQL deben revisarse los prerrequisitos y permisos vigentes, y acordarse proveedor, almacén, producto, costo, cantidades, folio, pagos y efectos exactos. Recibir/cancelar afecta existencias, costo promedio, auditoría y sincronización; pagar puede afectar caja. Restaurar la cantidad de stock no garantiza restaurar el costo promedio ni borra los registros históricos, por lo que la limpieza debe diseñarse y autorizarse expresamente. No se ejecutó ninguna consulta o escritura real de Compras/proveedores en esta tanda ni se inició un worker.

También quedan pendientes concurrencia y replay reales, combinaciones de roles y revisión del desarrollador antes de cerrar el módulo. Este archivo registra avance; no declara el cierre funcional ni sustituye la documentación final posterior a ese cierre.

Los cambios previos del repositorio se conservaron. No hubo staging, commits, push ni PR. AGENTS.md y el contexto maestro frontend v1.1 permanecen íntegros y locales, con sus hashes sin cambios. No se modificaron dependencias, configuración Git, backend ni migraciones.
