# POS, Ventas, Clientes, Compras e Inventario: prueba conjunta

Fecha: 23 de noviembre de 2026, America/Mexico_City.

Estado: **VALIDADO CON DATOS SIMULADOS COMPARTIDOS. PRUEBAS REALES Y CIERRE DE LOS MÓDULOS PENDIENTES.**

## Resultado y alcance

POS, Ventas, Clientes, Productos, Compras/proveedores e Inventario avanzado están disponibles desde el menú en una única dirección de prueba, `http://127.0.0.1:5184`. Se utilizan sus pantallas actuales y las mismas existencias y movimientos en memoria. El usuario ficticio normal conserva los permisos de los módulos existentes, además de los incorporados para Compras e Inventario; el usuario de solo consulta no puede crear ventas ni ejecutar mutaciones.

No se cambiaron las pantallas de producción, rutas, navegación, cliente HTTP, backend, dependencias, migraciones, reglas ni contexto maestro. Tampoco se operó sobre PostgreSQL real, se enviaron eventos a Ecommerce o se prepararon archivos en Git. Los avisos de simulación y el acceso automático con identidad ficticia se inyectan exclusivamente desde el servidor de prueba; no forman parte del frontend normal.

## Archivos de esta etapa

- `apps/web/tests/commercial-integrated-browser.mjs`: servidor Vite aislado, sesión ficticia con permisos de consulta/operación según escenario, aviso visible y enrutamiento local de API. Configuración y entorno Vite desactivados (`configFile:false`, `envDir:false`), sin proxy a la API real.
- `apps/web/tests/commercial-integrated.test.mjs`: diez casos de integración, navegación por permisos y HTTP local.
- `apps/web/tests/purchase-fixture-state.mjs`: acepta opcionalmente el oráculo de Inventario. Las recepciones y cancelaciones actualizan el estado compartido antes de confirmar el documento. Los escenarios anteriores conservan su funcionamiento sin este argumento.
- `apps/web/tests/inventory-advanced-fixture.mjs`: adaptador de recepción/cancelación que prepara y valida todas las líneas antes de aplicar cantidades, costos, movimientos y eventos ficticios. Permite consultar la existencia compartida al resumir Compras.
- `apps/web/tests/pos-fixture-state.mjs`: adaptador opcional para comprobar el disponible y registrar movimientos de venta sobre el mismo inventario; los simuladores anteriores mantienen su modelo cuando no se proporciona adaptador.
- `apps/web/tests/sale-actions-fixture.mjs`: devoluciones y cancelaciones restituyen el inventario compartido antes de confirmar el documento. Se reutilizan los límites de devolución y reembolso existentes.
- Este informe de avance y el enlace del índice `docs/frontend/README.md`.

Los informes individuales siguen vigentes: [Compras y proveedores](compras-proveedores-avance.md) e [Inventario avanzado](inventario-avanzado-avance.md). Este documento no constituye su cierre formal.

## Estado compartido

El producto inventariable P-001 inicia con cantidad `10.000`, reservado `2.000` y disponible `8.000` en Almacén 1; Almacén 2 inicia con `4.000`, reservado `1.000` y disponible `3.000`. Son registros ficticios, sin relación con el artículo real que debe conservar una pieza en pruebas autorizadas posteriores.

Crear una compra BORRADOR no modifica existencias. Recibirla añade las cantidades inventariables, pondera el costo promedio y registra una ENTRADA por línea con documento COMPRA. Cancelar una compra recibida sin pagos exige disponible suficiente, respeta lo reservado y registra una SALIDA con documento CANCELACION_COMPRA. La salida conserva el costo promedio vigente: restaurar la cantidad no implica restaurar el costo anterior. Los servicios no generan movimientos.

Ajustes y traspasos utilizan las mismas existencias que Compras. Si consumen mercancía y dejan disponible insuficiente, la cancelación de compra falla sin modificar su estado ni registrar una salida. Un pago no modifica Inventario y bloquea la cancelación posterior conforme al flujo existente. Los eventos de sincronización solo se cuentan como PENDIENTES en memoria; no existe trabajador ni envío externo.

POS consulta el disponible de ese mismo inventario, en lugar de utilizar la existencia independiente de su simulador anterior. Registrar una venta añade SALIDA con documento VENTA; devolver registra ENTRADA con documento DEVOLUCION_VENTA; cancelar una venta sin devoluciones registra ENTRADA con documento VENTA, conforme a los repositorios backend inspeccionados. Las entradas utilizan el costo del movimiento original y ponderan el promedio vigente. Los servicios no afectan stock. Listado, detalle, consulta de operación por clave, historial de devoluciones y resumen financiero reutilizan el oráculo de Ventas. Clientes conserva su buscador y la selección del comprador en POS.

Los estados de Ventas se separan por escenario, como los de Compras e Inventario. El escenario normal utiliza la fecha UTC actual para sus documentos de venta y devolución; el simulador POS individual mantiene sus fechas fijas anteriores para conservar sus pruebas.

El oráculo prepara todas las líneas antes de aplicar sus efectos. Esta comprobación no demuestra aislamiento, bloqueos ni transacciones de PostgreSQL real. El kardex sigue mostrando una base reconstruida de `7.000` y un movimiento histórico ficticio de entrada de tres piezas; no debe confundirse con la compra creada desde el formulario.

Los reintentos de recepción y cancelación reutilizan la clave y el cuerpo. Una respuesta 503 posterior al registro puede recuperarse sin repetir movimientos ni eventos. Las protecciones persistentes de Compras e Inventario mantienen sus claves de almacenamiento independientes, como en el frontend existente.

## Validación ejecutada

Comandos desde `apps/web`:

```powershell
node --experimental-strip-types --test --test-reporter=dot tests/*.test.mjs
npm run lint
```

Resultado de la ampliación con POS, Ventas y Clientes: **102 pruebas aprobadas, 0 fallidas**, incluidos diez casos de integración conjunta; ESLint correcto. No se repitió el build de producción porque no se modificó código de aplicación, configuración ni dependencias. La compilación validada en la etapa anterior se conserva como antecedente, no como ejecución nueva.

| Caso nuevo | Resultado |
| --- | --- |
| Borrador, recepción y cancelación | Cantidad 10 → 12 → 10; reserva 2; documentos y movimientos asociados; costo 100 → 110 al recibir dos piezas a 160, conservado al cancelar |
| Ajuste antes de cancelar | Con disponible 1, cancelar dos piezas responde 409; se conserva compra RECIBIDA, stock e historial; restaurar disponible permite cancelar |
| Respuesta incierta | Recepción/cancelación con 503 y reintento de misma clave conservan un solo efecto; otro contenido con esa clave se rechaza |
| Traspaso después de recibir | Transferir nueve piezas deja origen 3, destino 13 y reserva de origen 2; cancelar la compra de dos piezas se rechaza por disponible insuficiente |
| Servicios, pago y permisos | Servicio fraccionario y pago por transferencia no añaden movimientos; compra con pago no se cancela; usuarios de consulta/sin permiso no escriben en ninguno de los dominios |
| HTTP en una dirección | API de Compras, stock y kardex coherentes; páginas comerciales con aviso; catálogo acotado; POST de una ruta ajena rechazado |
| Menú y permisos de consulta | POS, Ventas y Clientes visibles con los accesos anteriores; usuario de consulta sin crear ventas, devolver ni cancelar; sin permiso no escribe |
| Compra → venta → devoluciones | Compra recibida lleva stock a 12; venta de tres piezas a 9; devoluciones de una y dos a 12; historial, cliente y neto financiero coherentes, sin movimientos duplicados al repetir la clave de venta |
| Cancelación de venta y costo | Stock 10 → 8 por venta de dos; compra de dos a costo 150 deja cantidad 10 y promedio 110; cancelar la venta devuelve dos a costo original 100, dando cantidad 12 y promedio 108.3333; segundo intento no añade movimientos |
| Disponible consumido por venta | Vender nueve se rechaza con disponible 8 y se permite tras recibir dos; deja cantidad 3 y reserva 2; no permite cancelar la compra hasta devolver una pieza. Reembolso inválido no modifica stock ni historial |

Primera revisión ejecutada desde el navegador, con Compras e Inventario en la misma sesión:

1. Crear `CONJUNTA-UI-001`, proveedor PROV-QA, Almacén 1, dos piezas P-001 a costo 160 e impuesto 16%. Total `371.20`.
2. Confirmar recepción desde el detalle y navegar mediante el menú a Inventario: cantidad `12.000`, reserva `2.000`, disponible `10.000`, costo promedio `110.0000`.
3. Abrir kardex: entrada COMPRA por `2.000`, documento de la compra y saldo `12.000`.
4. Volver a Compras y cancelar con motivo y confirmación. Documento CANCELADA; kardex conserva entrada y salida; cantidad final `10.000`, disponible `8.000` y base reconstruida `7.000`.
5. Consultar proveedor, contacto y domicilio desde Proveedores. Abrir el detalle de compra cancelada en una segunda pestaña del mismo simulador. No se observaron errores ni advertencias en la consola revisada.

Revisión adicional desde el navegador tras ampliar y reiniciar el simulador:

1. Menú con Punto de venta, Ventas, Productos, Inventario, Clientes, Caja, Compras y Proveedores. El reinicio descartó únicamente los registros ficticios del proceso anterior.
2. Desde POS seleccionar Almacén 1, una pieza P-001, cliente C-001 y pago por transferencia de `116.00`; confirmar la venta `VTA-2-20261123-000001` (ID 99).
3. Abrir listado y detalle en Ventas; comprobar cliente e importes. Registrar devolución total `DEV-POS-CONJUNTO-001` desde el formulario, con motivo y reembolso de `116.00`.
4. Registrar otra venta de una pieza sin cliente, `VTA-2-20261123-000002` (ID 100), por `116.00`; cancelar desde el detalle con confirmación. Venta CANCELADA.
5. Consultar Clientes desde el menú; comprobar el registro activo C-001 y sus condiciones. Consultar kardex: venta 99 (10 → 9), devolución 200 (9 → 10), venta 100 (10 → 9), cancelación de venta 100 (9 → 10). Existencia final `10.000`, reserva `2.000`, disponible `8.000`, base reconstruida `7.000`.
6. POS quedó abierto y listo para una nueva captura, con todos los accesos visibles. La pestaña de Compras quedó en el listado actualizado del proceso nuevo. Consola revisada sin errores ni advertencias.

Los ajustes, traspasos, permisos y recuperación de 503 se comprobaron con los casos automatizados. No se afirma una nueva revisión móvil ni una prueba de esos cuatro flujos desde formularios durante esta etapa.

Las capturas de recepción, cancelación y detalle de la primera revisión se guardaron fuera del repositorio, en la carpeta de evidencias autorizada, con prefijo `compras-inventario-`.

La ampliación añade `pos-ventas-clientes-menu-conjunto.jpg` y `pos-ventas-clientes-kardex-conjunto.jpg` en la misma carpeta de evidencias externa. La captura del menú representa la vista final de esta ampliación.

## Revisión manual conjunta

Para iniciar nuevamente el simulador:

```powershell
cd C:\Users\taiga\Documentos\POSMYCLETH\apps\web
node tests/commercial-integrated-browser.mjs
```

Abrir `/pos`, `/sales`, `/customers`, `/purchases`, `/suppliers` o `/inventory` bajo `http://127.0.0.1:5184`. No requiere credenciales reales. Navegar entre módulos conserva el estado del servidor. Los datos desaparecen al reiniciar el proceso; escribir `stop` en su terminal lo cierra. No existe un borrado ni reinicio de PostgreSQL.

Para repetir el ciclo usar otro folio de compra, seleccionar P-001 y un costo explícito, guardar borrador y recibirlo. En Inventario seleccionar el mismo almacén y abrir el kardex. Para revertir esa recepción, cancelar la compra sin pagos y con disponible suficiente. Volver a consultar o actualizar la sección después de cada cambio; no se incorporó actualización en tiempo real entre pestañas.

La consulta con `?fixture=read-only` utiliza identidad de solo consulta; `?fixture=no-permission` rechaza el acceso. `?fixture=fault-receive` prepara una compra en borrador y simula respuesta perdida al recibir; `?fixture=fault-cancel` prepara una recibida y simula respuesta perdida al cancelar. Cada escenario tiene existencias e historial independientes. Al seleccionar un escenario, conservarlo al recargar esa dirección; una dirección sin `fixture` utiliza el escenario normal.

El alcance conjunto cubre POS, Ventas, Clientes, Productos, Compras/proveedores e Inventario, más los catálogos y sesiones de caja necesarios para los cobros/reembolsos y pagos de compra. No sustituye el simulador de Caja avanzada: no integra aperturas/cierres, movimientos manuales ni sus saldos compartidos. Las operaciones financieras son ficticias. El catálogo comercial admite P-001 y el servicio SERV-001; los artículos fraccionario y sin existencia de Inventario permanecen disponibles para probar ese módulo. Clientes es consulta/selección; no se añadieron altas ni edición.

Quedan pendientes las pruebas específicas contra PostgreSQL local, la revisión del desarrollador y el cierre de cada módulo. Cualquier operación real requiere identificar y autorizar registros, efectos y restitución antes de ejecutarla.
