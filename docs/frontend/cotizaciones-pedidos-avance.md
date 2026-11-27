# Cotizaciones, órdenes y pedidos — avance frontend

Fecha: 23 de noviembre de 2026, America/Mexico_City.

Estado: **IMPLEMENTADO Y VALIDADO EN AISLAMIENTO. INTEGRACIÓN REAL Y CIERRE PENDIENTES.**

## Alcance y organización

Se incorporaron `/quotes/:documentId?`, `/sales-orders/:documentId?` y `/customer-orders/:documentId?`, con navegación por permisos, listado paginado, búsqueda por folio/estado, detalle, captura y edición permitida por estado. Se conserva el resto del menú: POS, Ventas, Productos, Inventario, Clientes, Caja, Compras y Proveedores.

El motor común vive en `apps/web/src/features/quotations/`: configuración de cada documento, tipos, validadores y parser, servicio HTTP, captura, conversión, vista de trabajo, protección de mutaciones y estilos. `features/orders/` y `features/customer-orders/` contienen las entradas específicas; las páginas correspondientes están en `src/pages/`. Las páginas nuevas cargan bajo demanda desde `AppRouter.tsx`.

Se reutilizan cliente HTTP, sesión, permisos, consultas remotas, catálogo de productos, buscador de clientes, selector de almacén/sucursal, métodos de pago, selector de sesión propia de caja, paginación y utilidades decimales existentes. Seleccionar sucursal mediante el almacén requiere `INVENTARIO.VER`; capturar partidas requiere `PRODUCTOS.VER`, y seleccionar un cliente requiere `CLIENTES.VER`. No se cambió el catálogo backend de permisos.

Las capturas sin enviar permanecen en el estado local del formulario: no se promete conservarlas después de navegar o recargar. Los documentos guardados se consultan desde la API. La protección de intentos enviados es independiente y sí persiste en `sessionStorage`.

## Contratos inspeccionados

Todos los endpoints usan `/api/v1` y autenticación existente.

| Dominio | Consulta | Escrituras | Permisos |
| --- | --- | --- | --- |
| Cotizaciones | GET `/quotes`, `/quotes/:id` | POST `/quotes`, PATCH `/quotes/:id`; POST `send`, `accept`, `reject`, `expire`, `cancel` bajo `/quotes/:id/` | `COTIZACIONES.VER`, `COTIZACIONES.CREAR` |
| Órdenes | GET `/sales-orders`, `/sales-orders/:id` | POST/PATCH, acciones `start`, `ready`, `cancel` y `convert-to-sale` | `ORDENES.VER`, `ORDENES.CREAR` |
| Origen de cotización | — | POST `/quotes/:id/convert-to-order` | `COTIZACIONES.CREAR` y `ORDENES.CREAR` |
| Pedidos | GET `/customer-orders`, `/customer-orders/:id` | POST/PATCH, acciones `confirm`, `prepare`, `ready`, `deliver`, `cancel` y `convert-to-sale` | `PEDIDOS.VER`, `PEDIDOS.CREAR` |

Convertir órdenes o pedidos a venta requiere además `VENTAS.CREAR`. No hay conversión directa de cotización a venta en estas rutas: el recorrido implementado es **Cotización → Orden → Venta**.

Listados: `{ok:true,data:{rows,total,page,pageSize}}`, con `q`, `estado`, `page` y `pageSize=20`. Los filtros y la página de listado se conservan en la URL al consultar y regresar. Detalle y mutaciones de documento: `{ok:true,data:documento}`. Los campos de partidas son `cotizacion_detalle`, `orden_venta_detalle` y `pedido_cliente_detalle`; no se confundieron con los DTO de Compras.

## Estados y efectos

- Cotización: BORRADOR editable → ENVIADA → ACEPTADA o RECHAZADA. Cancelación desde BORRADOR/ENVIADA; vencimiento desde ENVIADA cuando lo confirma la fecha de empresa del backend. ACEPTADA puede convertirse en orden y pasa a CONVERTIDA.
- Orden: PENDIENTE editable → EN_PROCESO → LISTA. Se puede cancelar antes de facturación si no tiene venta asociada. Una orden originada en cotización solo admite editar fecha/observaciones; conserva cliente y partidas.
- Pedido: PENDIENTE editable → CONFIRMADO → EN_PREPARACION → LISTO → ENTREGADO. Requiere cliente. Se puede cancelar en los estados anteriores a entrega si no tiene venta asociada.

Crear, editar o cambiar el estado de estos documentos no mueve ni reserva inventario en el contrato actual. Convertir a venta sí utiliza el motor transaccional existente de Ventas. El frontend solicita folio, almacén de la misma sucursal, observaciones y entre uno y veinte pagos; no envía precios, partidas modificadas ni totales arbitrarios al convertir. El efectivo requiere sesión propia abierta de la sucursal y el crédito requiere cliente.

El backend conserva los importes históricos del documento y rechaza otra venta asociada, incluso si la primera fue cancelada. La orden conserva LISTA y el pedido LISTO después de convertir: no se marca FACTURADA/FACTURADO ni ENTREGADO artificialmente. La entrega es una acción posterior independiente. El DTO actual del documento no expone el identificador de la venta asociada; no se inventó un enlace ni se prometió detectar esa asociación solo con su estado operativo. La API controla el intento de segunda conversión.

## Precisión y comprobaciones

IDs BIGINT como cadenas, con límite 9223372036854775807; cantidades a tres decimales, precios/descuentos/impuestos a cuatro y dinero a dos. Se reutiliza aritmética escalada BigInt para verificar líneas y totales conforme al redondeo de SQL. Se validan calendario real, folios, longitudes, entre una y cien partidas sin productos repetidos, relaciones de empresa/sucursal/cliente y FK de cada partida con su documento.

La respuesta de una mutación debe conservar el folio, documento, contexto, estado esperado y cantidades/descuentos enviados. Las conversiones comprueban vínculo de origen e importes históricos. La confirmación presenta cliente, sucursal, partidas, cantidades, descuentos, total, destino y pagos antes del POST.

## Respuestas inciertas

Estas rutas no ofrecen idempotencia general mediante `Idempotency-Key`; no se añadió una cabecera que aparentara ofrecerla. `useSafeMutation.tsx` guarda antes del envío un descriptor bajo `posmycleth.workflow.pending.v1`: empresa, usuario, marcador, etiqueta y ruta. No guarda cuerpos ni credenciales. El bloqueo es síncrono y la respuesta de una identidad anterior o componente desmontado no modifica la vista nueva.

Errores de red, 408, 409, 5xx o un 2xx inconsistente conservan la protección tras recargar. No se reenvían operaciones automáticamente. Se permite consultar folio/documento/asignación con GET y, después de revisión expresa, liberar el bloqueo; esto no demuestra que la solicitud anterior haya terminado. Una identidad distinta no puede liberar un descriptor válido ajeno. Un descriptor ilegible se muestra como tal y exige revisión manual. Un fallo de almacenamiento impide iniciar el POST.

## Validación

La batería frontend completa pasó con **116 pruebas, 0 fallidas**: 102 anteriores y catorce nuevas en `tests/workflows.test.mjs`. Incluye precisión, fechas, DTO corruptos, estados, conservación de cliente/partidas, conversión duplicada, pagos insuficientes, falta de stock, permisos, administración y crédito. `npm run build` y `npm run lint` correctos. Build: 209 módulos; paquete inicial de 462.52 kB, sin el aviso de chunk mayor de 500 kB después de cargar las páginas nuevas bajo demanda.

Revisión de formularios en el simulador conjunto:

1. Crear COT-UI-001 con cliente C-001 y dos P-001: subtotal 200, impuesto 32, total 232; enviarla y aceptarla.
2. Convertirla en ORD-UI-001. Editar observaciones conservando cliente y partidas; iniciar y marcar LISTA.
3. Convertir en VTA-ORD-UI-001 con transferencia 116 y crédito 116. Detalle de venta, importes históricos y crédito documental correctos.
4. Crear PED-UI-001, referencia REF-CLIENTE-001, un P-001. Confirmar, preparar y marcar LISTO; convertir en VTA-PED-UI-001 por efectivo 116, usando caja/sesión ficticia 6. Registrar entrega después: ENTREGADO.
5. Verificar kardex compartido: salidas de dos y una piezas, existencia 7, reserva 2, disponible 5. El catálogo parte de diez piezas ficticias, no del producto real que debe conservar una pieza.
6. Escenario `workflow-fault`: 503 después de crear COT-FAULT-UI-001, recarga con bloqueo conservado, consulta del folio con un único registro y sin segundo POST.
7. Escenario `read-only`: no aparecen acciones de crear cotización, usuario o rol.

El simulador se reinició para aplicar el contrato definitivo de contraseña. Después se restituyeron por HTTP local exclusivamente los ejemplos ficticios anteriores y se volvieron a comprobar documentos, crédito y kardex desde navegador. Los ciclos de formulario descritos se ejecutaron antes de esa restitución; no se presentan las operaciones de preparación por HTTP como nuevas acciones de formulario.

Se revisó escritorio, con consola sin errores/advertencias en la comprobación final. Se intentó emular 390×844, pero el navegador siguió reportando 1265 px de ancho. Se restauró el viewport y **la validación móvil queda pendiente**; no se contabiliza esa captura como evidencia móvil.

## Repetición y pendientes

Desde `apps/web`, ejecutar `node tests/commercial-integrated-browser.mjs` y abrir `http://127.0.0.1:5184/quotes`, `/sales-orders` o `/customer-orders`. Todo el simulador intercepta la API en loopback, sin proxy, `.env`, Prisma o PostgreSQL. El estado es en memoria y desaparece al reiniciar; `stop` cierra el servicio. `?fixture=read-only`, `?fixture=no-permission` y `?fixture=workflow-fault` son escenarios independientes. Una recarga debe conservar el parámetro del escenario seleccionado.

No se modificaron backend, dependencias, migraciones, reglas ni contexto maestro. No se hicieron commits, staging, push o PR. Quedan pendientes integración real autorizada, revisión móvil y cierre del desarrollador. Las capturas están en la carpeta externa de evidencias autorizada, no en el repositorio.
