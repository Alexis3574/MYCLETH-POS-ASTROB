# Transferencias entre almacenes — POSMYCLETH

El módulo registra documentos en BORRADOR y los completa con una salida del almacén origen y una entrada del almacén destino. Ambas usan la misma cantidad y el costo promedio del origen en el momento de confirmar. El trigger de inventario aplica las existencias dentro de la misma transacción. Crear o cancelar un borrador no mueve inventario ni reserva mercancía.

## Estado de la entrega

La fuente de referencia es el informe `transfers-inspection-2026-10-07T19-32-40-786Z.txt`, obtenido en `devalex`, commit `7ed15c5a0dcd24c5d6932eef675d7e252ac7d578`, sobre PostgreSQL 17.4. Sus 106 archivos se recuperaron y verificaron contra los hashes del propio informe.

Transferencias está preparado para instalación. Se validó el esquema Prisma, se generó el cliente y se aprobó la compilación específica de Transferencias y de sus pruebas preparadas en una copia local. También se analizó la sintaxis SQL y PL/pgSQL de la nueva migración. Estas comprobaciones no ejecutaron las pruebas ni la migración contra una base.

El informe no incluye todos los archivos de la API. La compilación completa debe confirmarse en el equipo del usuario después de instalar. Algunas dependencias de autenticación se recuperaron de las fuentes anteriores exclusivamente para la compilación local; no se incluyen ni reemplazan en el paquete.

Transferencias todavía NO está instalado ni validado funcionalmente en el entorno del usuario. No debe considerarse cerrado después de un typecheck.

## Hallazgos del esquema actual

| Elemento | Confirmación |
| --- | --- |
| Estados de transferencia | BORRADOR, COMPLETADA y CANCELADA |
| Folio | Único por empresa; hasta 50 caracteres |
| Detalle | Único por transferencia y producto; cantidad positiva NUMERIC(14,3) |
| Existencia | Cantidad y reservado NUMERIC(14,3); disponible generado como cantidad menos reservado |
| Costo promedio | NUMERIC(14,4) |
| Movimientos | TRANSFERENCIA_SALIDA y TRANSFERENCIA_ENTRADA están permitidos |
| Duplicados de movimientos | Índice único parcial por documento, detalle, tipo y almacén |
| Aplicación del inventario | trg_movimiento_inventario_aplicar, habilitado |
| Permiso de escritura | INVENTARIO.TRANSFERIR, ID 18 |
| Roles con ese permiso | ADMIN, SUPERVISOR y ALMACEN, activos |
| Permiso de consulta | INVENTARIO.VER, ID 16 |
| Almacenes actuales | Sólo ALM-01, ID 1, en MATRIZ, empresa 1 |
| Procedimiento anterior | Generaba ambos movimientos sin costo_unitario y no fijaba un orden de productos |

El paquete usa los códigos de permisos. No crea permisos, no reasigna roles y no depende de que un ID coincida en otra instalación. La autorización de escritura se vuelve a comprobar dentro de la transacción. El alcance de almacenes sigue el aislamiento por empresa usado en Inventario; no agrega restricciones por usuario_sucursal.

Con un único almacén es posible instalar el módulo, pero una operación real requiere dos almacenes activos de la misma empresa. Esta instalación no crea un segundo almacén ni modifica las existencias actuales.

## Operaciones y rutas

La API incorpora `transferRouter` antes de las rutas generales y del middleware de errores.

| Método y ruta | Permiso | Resultado |
| --- | --- | --- |
| GET /api/v1/transfers | INVENTARIO.VER | Consulta paginada de documentos |
| GET /api/v1/transfers/:id | INVENTARIO.VER | Encabezado, detalles, movimientos e historial de operaciones |
| POST /api/v1/transfers | INVENTARIO.TRANSFERIR | Crea un BORRADOR |
| POST /api/v1/transfers/:id/complete | INVENTARIO.TRANSFERIR | Completa un BORRADOR |
| POST /api/v1/transfers/:id/cancel | INVENTARIO.TRANSFERIR | Cancela un BORRADOR y guarda el motivo |

Todas requieren JWT. El servidor toma empresaId y userId exclusivamente de req.auth. El cuerpo no admite empresa_id, usuario_id, estado, costos ni una bandera de sincronización.

Para crear, el cuerpo contiene almacen_origen_id, almacen_destino_id y detalles; cada detalle contiene producto_id y cantidad. Los IDs y las cantidades se envían como cadenas. Las cantidades admiten hasta tres decimales, deben ser positivas y no se redondean para aceptar más precisión. La unidad del producto debe permitir decimales para aceptar fracciones. El folio y las observaciones son opcionales; si falta el folio, se utiliza TR- seguido de la clave de creación. Se permiten hasta 100 productos por documento y hasta 1000 caracteres en observaciones.

El cuerpo de confirmación es un objeto vacío. El cuerpo de cancelación requiere motivo, con contenido no vacío y hasta 1000 caracteres. Los campos desconocidos se rechazan.

Los filtros de consulta son estado, almacen_id, almacen_origen_id, almacen_destino_id, producto_id, search, fecha_desde, fecha_hasta, page y limit. almacen_id incluye documentos donde el almacén participa como origen o destino. Las fechas necesitan hora y zona u offset. La búsqueda revisa folio y observaciones. El límite predeterminado es 20 y el máximo es 100. El orden es fecha descendente e ID descendente.

Una transferencia sólo puede pasar de BORRADOR a COMPLETADA o de BORRADOR a CANCELADA. No hay estado EN_TRANSITO, recepción parcial, edición, eliminación ni cancelación de documentos completados. Para retornar mercancía se registra una transferencia nueva con origen y destino invertidos. Un borrador no garantiza stock futuro: el disponible se verifica y bloquea al completar.

Las lecturas comprueban también la empresa de ambos almacenes, del creador y de los productos de los detalles. Un documento ajeno o con relaciones inconsistentes no se expone.

## Idempotencia y auditoría

Las tres escrituras requieren Idempotency-Key con UUID. Cada operación nueva utiliza una clave diferente; un reintento de la misma operación mantiene la clave original y el mismo contenido.

operacion_transferencia conserva empresa, documento, usuario, acción, clave, hash y respuesta JSON. Una restricción única por empresa y clave protege el registro. Un bloqueo transaccional de esa clave serializa solicitudes simultáneas, incluyendo el caso en que aún no existe un registro.

El hash incluye usuario, acción, ID del documento y contenido normalizado. En la creación se ordenan los detalles por ID de producto; reordenar la misma lista no cambia el contenido. Usar una clave con otro usuario, acción, documento o contenido devuelve un conflicto. Una operación fallida revierte todos sus cambios y no deja una respuesta de éxito registrada.

La creación inicial devuelve 201; su repetición devuelve 200. Completar y cancelar devuelven 200. Los reintentos incluyen replayed: true y el encabezado Idempotent-Replay: true. La respuesta guardada representa la operación original: repetir una creación después de completar devuelve el BORRADOR original, mientras GET devuelve el estado actual. No se crea una segunda auditoría al repetir.

La auditoría se escribe en pos.auditoria, con tabla transferencia_almacen, ID del documento y usuario. La confirmación incluye los estados de existencias antes y después, las cantidades, los costos y los movimientos. La cancelación conserva su motivo en la respuesta de operación y la auditoría. Todo se confirma o revierte junto con el documento y sus movimientos.

## Transacciones, costos y concurrencia

El servicio abre una transacción ReadCommitted y utiliza este orden: cuenta y empresa; clave de idempotencia; encabezado existente; almacenes por ID; productos por ID; existencias por producto e ID de almacén. El procedimiento aplica el mismo orden de productos y almacenes. Los bloqueos de producto utilizan FOR NO KEY UPDATE para permitir las comprobaciones de claves foráneas de los movimientos. Los bloqueos se mantienen hasta terminar la transacción.

Para un destino sin existencia se inicializa una fila con ceros y luego se bloquea. No se escribe disponible ni se suma la cantidad transferida desde TypeScript. Las entradas y salidas se aplican exclusivamente por el trigger. Si la operación falla, la fila inicializada también se revierte.

Se valida cantidad contra disponible, no contra cantidad total. El reservado permanece intacto en ambos almacenes. También se valida que la entrada no supere el rango NUMERIC(14,3) del destino. Las cantidades se comparan como enteros de milésimas usando BigInt.

El costo de ambos movimientos es el costo promedio del origen al confirmar. El origen conserva su costo promedio. El destino obtiene el promedio ponderado entre su inventario previo y lo recibido, con la precisión de cuatro decimales del esquema. La verificación del promedio utiliza BigInt y el mismo redondeo decimal de PostgreSQL. Ese redondeo de costo es parte del esquema; las cantidades no se redondean.

Después del procedimiento, el servicio verifica estado, número y correspondencia de movimientos, usuario, cantidades, costo de cada movimiento, existencias, disponibles y reservas. Un resultado inesperado causa rollback. El índice único de movimientos sigue protegiendo los pares de salida y entrada.

Los conflictos de serialización o interbloqueo tienen hasta tres intentos locales. No hay llamadas HTTP dentro de esa transacción. Si persiste el conflicto, la respuesta indica reintentar con la misma clave. No se reintentan automáticamente errores de validación o falta de disponible. El orden consistente reduce interbloqueos; no implica que otros módulos nunca puedan producir un conflicto.

La migración reemplaza sp_completar_transferencia conservando su firma de dos BIGINT y calificando explícitamente el esquema pos. Añade controles de empresa, permiso, estados, productos, unidades, disponibilidad, destino, costos y trigger. Los movimientos históricos no cambian. Su auditoría e idempotencia se gestionan a través del servicio de la API.

También añade un trigger en transferencia_detalle: bloquea el encabezado y permite cambiar detalles sólo mientras sea BORRADOR. Así, una modificación concurrente no puede cambiar el contenido mientras se confirma. El trigger de aplicación de existencias y su función quedan intactos.

Los movimientos guardan documento_tipo TRANSFERENCIA, documento_id y documento_detalle_id. Las consultas y el kardex actuales de Inventario ya incluyen los tipos de Transferencias, por lo que no requieren cambios.

## Ecommerce

El controlador inspeccionado ajusta Product.quantity, un entero por producto o variación. Su contrato recibe operation_id y adjustment; no recibe un almacén. El POS y su outbox tampoco tienen un mapeo de almacenes participantes.

Esto confirma el contrato actual de la API, pero no define si esa cantidad representa todos los almacenes del POS o sólo un subconjunto. Esa regla de negocio sigue pendiente. Una transferencia entre dos almacenes incluidos conserva el total; una transferencia que cruza el límite de un subconjunto podría cambiar el stock publicado.

Este módulo no genera eventos de outbox ni llama al Ecommerce. La respuesta lo declara con eventos_creados: 0 y politica: SIN_EVENTOS_ALMACENES_PENDIENTES. Ese campo no afirma que el stock remoto esté actualizado. Las pruebas de Transferencias tampoco validan sincronización real. Antes de añadir eventos u operar considerando al Ecommerce como reflejo de un subconjunto, debe confirmarse el alcance y qué almacenes participan. La outbox entera existente no acepta fracciones y no debe recibir cantidades redondeadas silenciosamente.

## Archivos y migración

La estructura es src/modules/transfers con controllers, services, repositories, validators, errors, types y utils, más transfer.routes.ts y transfer.schema.ts. Se reutilizan las consultas de contexto, los helpers decimales y las representaciones de stock de Inventario.

La migración 20261007200000_add_warehouse_transfers incorpora operacion_transferencia, sus restricciones e índices, un índice de consulta en transferencia_almacen, el trigger de detalles y el procedimiento corregido. El modelo Prisma añade las relaciones inversas en empresa, usuario y transferencia_almacen. No se modifica ninguna migración aplicada previamente.

## Instalación

Extrae la carpeta pos-transfers en C:/Users/taiga/Documentos/POSMYCLETH. Desde Git Bash:

```bash
cd /c/Users/taiga/Documentos/POSMYCLETH/apps/api
npx tsx ../../pos-transfers/install-transfers.ts
```

El instalador verifica devalex, los hashes de app.ts y schema.prisma respecto del informe y los archivos del paquete. Si alguno cambió o un archivo nuevo ya existe con otro contenido, se detiene antes de escribir. Conserva copias previas de los dos archivos existentes en pos-transfers/backups. Repetir la instalación con el mismo contenido es válido.

Cuando el instalador termine correctamente:

```bash
npx prisma validate &&
npx prisma migrate deploy &&
npx prisma generate &&
npm run typecheck
```

Estos comandos validan, aplican las migraciones pendientes, generan el cliente y compilan. No ejecutan las pruebas. migrate deploy puede aplicar otras migraciones pendientes que existan en el repositorio; el informe sólo mostraba las cuatro migraciones anteriores ya terminadas.

Conserva el paquete y sus copias previas hasta confirmar la instalación y el typecheck. Después de confirmarlos, se pueden eliminar el inspector temporal, su informe y la carpeta pos-transfers. El código operativo, la migración, esta documentación y las pruebas ya habrán quedado en apps/api. No elimines scripts o pruebas de otros módulos. El rollback de una migración aplicada requiere un cambio de base explícito; las copias de app.ts y schema.prisma sólo respaldan archivos.

## Pruebas preparadas, sin ejecutar

| Archivo en apps/api/tests/transfers | Cobertura prevista |
| --- | --- |
| transfer-values.test.ts | Normalización, hashes, orden de IDs y costo ponderado |
| transfer-schema.test.ts | Cuerpos, IDs, estados, duplicados, precisión y campos rechazados |
| transfer-validator.test.ts | Disponible, reservas, unidades, rango y traducción de errores |
| check-transfers-setup.ts | Modelo, procedimiento, triggers y permiso de instalación |
| transfer-postgres.rollback.ts | Confirmación, costos, reintentos, auditoría, aislamiento, cancelación y fallo tras movimientos parciales |
| transfer-concurrency.ts | Reintentos simultáneos, competencia por stock y transferencias opuestas |
| test-transfers-http.mjs | JWT, permisos, aislamiento, rutas, estados e idempotencia HTTP |
| support/database-fixture.ts | Datos separados para dos almacenes y limpieza del entorno de pruebas |

Ninguna prueba fue ejecutada. No se incluyen instrucciones para ejecutarlas hasta que el usuario las solicite. Las pruebas de base requieren una base identificada como entorno de pruebas y habilitación explícita. Las HTTP requieren un entorno aislado y dejan documentos de prueba completados o cancelados, porque la API conserva su historial.

## Pendiente obligatorio de continuidad

Productos/Catálogo e Inventario están implementados e instalados, pero todavía NO están validados funcionalmente en el entorno del usuario y NO deben considerarse cerrados. El typecheck y las comprobaciones en una copia aislada no sustituyen esa validación.

En Productos/Catálogo siguen pendientes endpoints, permisos, aislamiento entre empresas, altas, edición, estados, duplicados, impuestos y compatibilidad con ventas y sincronización del Ecommerce. Se conservan:

- apps/api/tests/products-catalogo/product-values.test.mjs
- apps/api/tests/products-catalogo/product-schema.test.ts

En Inventario siguen pendientes instalación, validaciones, consultas, ajustes, idempotencia, transacciones, rollback, permisos, aislamiento entre empresas, concurrencia y funcionamiento HTTP, además de sincronización real con el Ecommerce y compatibilidad con ventas, cancelaciones y devoluciones. Se conservan:

- apps/api/tests/inventory/check-inventory-setup.ts
- apps/api/tests/inventory/test-inventory-http.mjs
- apps/api/tests/inventory/inventory-values.test.ts
- apps/api/tests/inventory/inventory-schema.test.ts
- apps/api/tests/inventory/inventory-validator.test.ts
- apps/api/tests/inventory/inventory-postgres.rollback.ts
- apps/api/tests/inventory/inventory-concurrency.ts

Los auxiliares de instalación e inspección anteriores fueron eliminados. Las comprobaciones de instalación y HTTP de Inventario están en tests/inventory y no en scripts/inventory. Se mantienen las reglas existentes: disponible generado; stock aplicado por el trigger; ajustes mediante ajuste_inventario e idempotencia; tres decimales locales y outbox entera; identificación del Ecommerce por código de barras; SKU, código de barras, unidad, tipo y control de inventario fijos después del alta; cambios administrativos del catálogo sin sincronización automática.

Transferencias se añade a los pendientes hasta confirmar instalación, typecheck completo y pruebas funcionales en el entorno del usuario. El alcance de almacenes del Ecommerce sigue pendiente. Conservar estas condiciones en todos los siguientes mensajes de continuidad.

## Referencias técnicas

- [PostgreSQL 17: bloqueos explícitos](https://www.postgresql.org/docs/17/explicit-locking.html)
- [PostgreSQL 17: CREATE PROCEDURE](https://www.postgresql.org/docs/17/sql-createprocedure.html)
