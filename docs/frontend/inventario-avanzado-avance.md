# Frontend — Inventario avanzado: avance

Fecha: 22 de noviembre de 2026, America/Mexico_City.

Estado: **IMPLEMENTADO Y VALIDADO EN AISLAMIENTO. PRUEBAS REALES Y CIERRE DEL DESARROLLADOR PENDIENTES.**

## Alcance implementado

La ruta existente `/inventory` incorpora cinco secciones: Existencias, Alertas de stock, Movimientos, Kardex y Traspasos. Se conserva el selector de almacenes autorizados. La consulta básica de existencias que utiliza Productos, `StockBrowser.tsx`, no se modificó.

Existencias muestra cantidades, reservas, disponible, costo promedio, unidad, mínimos/máximos y situación. Desde cada producto se abre su kardex o se prepara un ajuste si el usuario tiene permiso. Los límites son de consulta; esta etapa no modifica su configuración en el catálogo de productos.

Los ajustes pueden ser positivos o negativos, con cantidad, motivo, costo opcional para entradas y solicitud explícita de sincronización. Los traspasos permiten crear un borrador, consultar su detalle/historial, completarlo o cancelarlo mientras siga en borrador. No se implementa cancelación de traspasos completados, edición de documentos guardados, reservas de borradores, traspasos parciales ni correcciones directas de PostgreSQL.

Se reutilizan sesión, permisos, layout, cliente HTTP con `Idempotency-Key`, recursos remotos, búsqueda, paginación, selector de almacenes y las utilidades decimales existentes. No se añadieron dependencias, endpoints, migraciones, permisos ni cambios backend.

## Contratos inspeccionados

Todas las rutas usan `/api/v1` y la autenticación actual. Los IDs BIGINT se conservan como cadenas.

| Consulta u operación | Ruta | Permiso |
| --- | --- | --- |
| Almacenes autorizados | GET `/inventory/warehouses` | `INVENTARIO.VER` |
| Existencias | GET `/inventory/stock` | `INVENTARIO.VER` |
| Movimientos | GET `/inventory/movements` | `INVENTARIO.VER` |
| Kardex | GET `/inventory/kardex` | `INVENTARIO.VER` |
| Ajustar | POST `/inventory/adjustments` | `INVENTARIO.AJUSTAR` |
| Listar traspasos | GET `/transfers` | `INVENTARIO.VER` |
| Detalle de traspaso | GET `/transfers/:id` | `INVENTARIO.VER` |
| Crear borrador | POST `/transfers` | `INVENTARIO.TRANSFERIR` |
| Completar | POST `/transfers/:id/complete` | `INVENTARIO.TRANSFERIR` |
| Cancelar borrador | POST `/transfers/:id/cancel` | `INVENTARIO.TRANSFERIR` |

Inventario y el listado de traspasos usan `{ok:true,data:[],pagination:{page,limit,total,total_pages}}`; la consulta de stock añade el almacén. Kardex añade producto, almacén, periodo, resumen y existencia actual. El detalle de traspaso responde `{ok:true,data:documento}`. Las mutaciones de ambos dominios responden `{ok:true,replayed:boolean,data:resultado}`. No se confundieron con la respuesta anidada de Compras.

La interfaz no pide IDs técnicos al operador: selecciona almacén, producto y destino desde resultados autorizados. La API verifica el alcance de sucursales; los traspasos requieren acceso a ambos extremos. El backend conserva la validación definitiva de producto/unidad activos, tipo PRODUCTO y control de inventario; el DTO de stock no expone todos esos atributos.

## Existencias y alertas

La consulta utiliza productos activos con control de inventario, búsqueda por nombre/SKU/código y páginas de 20. Se distinguen cantidad total, reservado y disponible. La validación comprueba `cantidad - reservado = disponible` y que el indicador `bajo_minimo` coincida con el mínimo y el disponible recibidos.

La revisión de alertas se inicia con «Revisar alertas del almacén» y recorre el catálogo completo del almacén en páginas de 100, hasta un límite de 500 páginas. Detecta IDs repetidos y cambios de total durante el recorrido. Si la consulta falla, queda incompleta o supera el límite, se muestra un error; no se presenta la primera página como un resultado completo. Los resultados se paginan localmente de 20 en 20.

Se muestran agotados cuando el disponible es cero o negativo, bajo mínimo usando el disponible, sobre máximo usando la cantidad total y productos sin existencia registrada. La revisión es una consulta de varias páginas, no una instantánea transaccional única, un monitor continuo ni un sistema de notificaciones. Debe actualizarse después de cambios. No inventa un filtro `bajo_minimo` que el endpoint no admite.

## Movimientos y kardex

Movimientos permite consultar el almacén, aplicar el producto seleccionado o todos, tipo de movimiento y rango de fechas UTC. Muestra documento, motivo, cantidad, costo informado y estado del evento asociado, sin ofrecer reenvíos a Ecommerce.

Kardex requiere producto y almacén. Presenta base reconstruida, saldo inicial, entradas, salidas, saldo final del periodo y existencia/disponible actuales. Cada fila incluye cambio firmado, saldo anterior y posterior. Se explica que el método real es `RECONSTRUIDO_DESDE_EXISTENCIA_ACTUAL`: la base puede ser distinta de cero y no equivale a un inventario inicial certificado.

La validación comprueba el signo de cada tipo, la suma de cantidades, continuidad de filas y extremos de la primera/última página frente al resumen. Acepta saldos reconstruidos firmados. La existencia actual se distingue del saldo final de un periodo histórico.

Las fechas se validan como calendario real y rango ordenado, con límites independientes. Se envían en UTC desde `00:00:00.000Z` hasta `23:59:59.999Z`, conforme a la precisión de Date que utiliza el contrato backend. El rango y el tipo solo se aplican al confirmar el filtro. No se conserva el filtro de fecha al cambiar de sección; las selecciones de producto/almacén permanecen mientras no se cambie el contexto o se recargue.

## Ajustes

El formulario distingue entrada por ajuste y salida por ajuste. La cantidad tiene hasta tres decimales y debe ser positiva; el costo opcional de una entrada admite cuatro. Una salida no envía costo. Se respeta la unidad: las unidades enteras no permiten fracciones. Para sincronizar se requieren código de barras y cantidad entera entre 1 y 2147483647; sin sincronización se permiten fracciones cuando la unidad lo admite.

Antes de revisar una salida se comprueba el disponible consultado, conservando las reservas. Las entradas se comparan con el límite NUMERIC(14,3). La confirmación presenta producto, cantidad, costo cuando corresponde, motivo y si se solicita un evento. El servidor vuelve a validar el contexto y las cantidades vigentes.

Al confirmar, el frontend valida clave, empresa/usuario, producto, almacén, tipo, cantidades, motivo, costo y sincronización del resultado, además de la variación de existencias y la conservación de reservas. Muestra el resultado confirmado y el costo promedio devuelto; no calcula ni envía un costo promedio sustituto. Solicitar sincronización crea un evento pendiente según el backend; la interfaz no inicia un worker.

## Traspasos

El almacén seleccionado es el origen. El destino se elige entre almacenes autorizados y debe ser distinto. Se agregan productos desde las existencias del origen, sin duplicados, con hasta cien líneas y cantidades compatibles con la unidad. El folio es opcional: el backend vigente utiliza `TR-<clave UUID>` si no se proporciona. Crear un borrador no mueve ni reserva inventario.

El detalle muestra estado, productos, movimientos e historial de operaciones. Completar exige BORRADOR; la API comprueba el disponible en ese momento y registra una salida del origen y una entrada en el destino por producto. La validación de respuesta exige esa pareja, cantidades y almacenes correctos, reservas sin cambios, costo del origen conservado y costo ponderado del destino consistente.

Cancelar exige motivo y BORRADOR; no mueve stock. Un traspaso completado no ofrece cancelación. El backend actual declara `SIN_EVENTOS_ALMACENES_PENDIENTES`, con cero eventos Ecommerce para este módulo. Esto se distingue de los ajustes sincronizables.

Los formularios de ajuste/traspaso son capturas locales hasta su confirmación. Cambiar de contexto o recargar puede descartar una captura no enviada. Después del envío se protege el intento persistente descrito a continuación. No se afirma conservación de borradores locales de traspaso entre recargas.

## Idempotencia y recuperación

Se usa la cabecera opcional ya existente en el cliente HTTP. Cada nueva acción genera una UUID y guarda ámbito, acción, cuerpo normalizado y clave en `sessionStorage`, bajo `posmycleth.inventory.pending.v1`, antes del POST. No se guardan credenciales o tokens. Si el almacenamiento no funciona, no se envía; un registro dañado bloquea nuevas operaciones.

El envío y el reintento tienen bloqueo síncrono contra doble clic. Las respuestas recibidas después de desmontar la pantalla o cambiar de sesión no afectan la nueva identidad. Red incierta, 408, 409, 5xx, respuesta incompleta o inconsistente conservan la protección al navegar o recargar.

El operador puede confirmar el reintento con el mismo cuerpo y clave. Se explica que devuelve el resultado anterior si ya se registró o puede completar la operación si la primera solicitud nunca llegó. No se presenta como una consulta GET ni se reenvía automáticamente. El backend inspeccionado dispone de bloqueo y respuesta persistida por clave; su concurrencia real queda pendiente de validación.

Un intento de otra identidad no se recupera con el usuario actual. La liberación manual requiere revisión expresa y no prueba por sí misma que un envío anterior haya terminado. Recuperar un traspaso tras una recarga abre su almacén de origen y su detalle; el resultado de un ajuste recuperado se muestra aunque aún deba elegirse un almacén para seguir consultando.

## Código y validación

Archivos nuevos bajo `apps/web/src/features/inventory/`:

- `inventory.types.ts`, `inventory.logic.ts`, `inventory.parse.ts`, `inventory.service.ts`: contratos, precisión decimal, filtros, revisión completa de alertas, validación de respuestas y API.
- `InventoryWorkspace.tsx`, `InventoryStockPanel.tsx`, `InventoryLedger.tsx`: secciones, existencias, alertas, movimientos y kardex.
- `InventoryAdjustmentForm.tsx`, `InventoryTransferForm.tsx`, `InventoryTransfers.tsx`: captura y confirmación de ajustes/traspasos, detalle e historial.
- `useInventoryMutation.ts`, `InventoryPending.tsx`: envío único, persistencia y recuperación.
- `inventory.css`: presentación adaptable.

Se modificó únicamente la integración de Inventario en `apps/web/src/pages/CommercialPages.tsx`; Productos y Caja conservan sus componentes actuales. Las pruebas y el simulador están en `apps/web/tests/inventory-advanced.test.mjs`, `inventory-advanced-fixture.mjs` e `inventory-advanced-browser.mjs`.

Validaciones finales: **92 pruebas frontend correctas, 0 fallidas**, incluidas 18 nuevas de Inventario; TypeScript y Vite correctos, 185 módulos; ESLint correcto. El oráculo utiliza BigInt y lógica independiente del frontend, sin Prisma, `.env`, proxy ni PostgreSQL.

Casos comprobados en navegador:

| Caso | Resultado |
| --- | --- |
| Ajuste positivo +2 y negativo -2 | Cantidad 10 → 12 → 10; reservado 2 y disponible final 8; dos eventos sintéticos pendientes |
| Protección de reservas | Una salida de 11 con disponible 10 fue rechazada antes de confirmar |
| Kardex y fechas | Base reconstruida 7; movimientos y saldos coherentes; rango invertido rechazado y periodo del 22/11/2026 filtrado correctamente |
| Movimiento por tipo | Solo el ajuste negativo apareció al aplicar ese filtro |
| Traspaso completo de 3 | Origen 10 → 7, reservado 2; destino 4 → 7, reservado 1; costo destino 71.4286; una salida y una entrada, sin eventos nuevos |
| Cancelar otro borrador | CANCELADA, sin movimientos ni cambios adicionales de existencias |
| Revisión completa de alertas | 102 productos recorridos en dos páginas; una alerta situada en la segunda página |
| Catálogo cambiante | Error explícito y sin presentar la revisión como completa |
| Respuestas 503 | Ajustar, crear, completar y cancelar recuperados tras recargar, con dos solicitudes y una única clave por operación, sin duplicar efectos |
| Unidad fraccionaria | +0.125 al producto FRAC-001 sin sincronización: cantidad 1.375, reservado 0.250, disponible 1.125, cero eventos |
| Permisos | Solo consulta sin Ajustar/Nuevo traspaso; usuario sin INVENTARIO.VER rechazado |
| Datos incoherentes | Stock inconsistente rechazado sin botones de acciones por producto |
| Móvil 390 × 844 | Existencias y confirmación legibles, sin desbordamiento global; se volvió sin registrar el caso móvil y se restauró el viewport |

Los borradores para los casos de respuesta perdida al completar/cancelar se prepararon mediante HTTP contra el mismo simulador; sus confirmaciones y recuperaciones se hicieron desde el navegador. Los casos completos de creación y cancelación normal sí se recorrieron desde la interfaz. Se conservaron contadores finales y capturas fuera del repositorio.

Al terminar, el escenario normal contenía dos ajustes, un traspaso completado y otro cancelado: seis operaciones, cinco movimientos contando el movimiento histórico inicial y dos eventos de ajustes. Origen/destino del artículo principal quedaron en 7/7 en ese escenario simulado. Los otros escenarios son independientes. La pestaña nueva de revisión no registró errores ni advertencias de consola. Los HTTP 503 de incertidumbre y los rechazos deliberados no se consideran fallos inesperados.

Los registros de la noche local del día 22 aparecen como 23 de noviembre en UTC; no se alteró el reloj. Las imágenes principales son `inventario-kardex-simulado.jpg`, `inventario-traspaso-simulado.jpg`, `inventario-alertas-catalogo-completo.jpg` e `inventario-ajuste-movil.jpg`.

## Repetir la revisión aislada

```powershell
cd C:\Users\taiga\Documentos\POSMYCLETH\apps\web
node tests/inventory-advanced-browser.mjs
```

Abrir `http://127.0.0.1:5183/inventory` y elegir Sucursal 1 / Almacén 1. Usar P-001 para ajustes enteros y traspasos a Almacén 2. FRAC-001 permite fracciones sin solicitar sincronización; SIN-001 muestra ausencia de existencias. El comando `stop` cierra el proceso. Reiniciarlo restablece exclusivamente sus datos en memoria.

Escenarios mediante `?fixture=`: `fault-adjust`, `fault-create`, `fault-complete`, `fault-cancel`, `read-only`, `no-permission`, `limited`, `malformed-stock`, `malformed-kardex`, `malformed-transfer`, `paged-alerts` y `changing-alerts`. Cada uno tiene datos independientes; los traspasos se preparan antes de probar completar/cancelar. GET `/__qa/inventory` muestra únicamente datos, claves y contadores sintéticos.

## Pendientes y límites

No se ejecutaron operaciones reales de inventario, migraciones, cambios de permisos ni workers. La validación aislada no demuestra bloqueos de PostgreSQL, procedimientos y triggers reales, costo promedio real, auditoría u outbox efectivos. Antes de una prueba real deben revisarse entorno/prerrequisitos y acordarse almacenes, producto, cantidades, costos, sincronización y limpieza exactos, con autorización específica. La unidad real conservada para pruebas no se utilizó.

Un traspaso completado no se limpia cancelándolo: el backend solo permite cancelar borradores. Reponer cantidades con otro movimiento tampoco garantiza restaurar costos promedio ni elimina historiales. La prueba real y su cierre deben diseñarse expresamente.

Este documento registra avance; el cierre funcional y la documentación final requieren revisión del desarrollador. No hubo staging, commits, push ni PR. Se conservaron cambios previos y se mantuvieron íntegros y locales AGENTS.md y el contexto maestro frontend v1.1. No se modificaron backend, dependencias o configuración Git.
