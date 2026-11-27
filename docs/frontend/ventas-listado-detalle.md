# POSMYCLETH — Frontend: Ventas, listado y detalle

**Estado:** IMPLEMENTADO, VALIDADO y DOCUMENTADO.
**Fecha de validación y cierre funcional:** 10 de noviembre de 2026.
**Cierre:** confirmado por el desarrollador después de la prueba contra el backend real.
**Alcance:** consulta de documentos de venta y su información comercial y financiera.

## 1. Objetivo

Permitir localizar ventas existentes y consultar sus artículos, importes, pagos y devoluciones desde el panel administrativo, respetando la autenticación y el permiso `VENTAS.VER`.

La interacción toma como referencia funcional el flujo público de consulta de SICAR: filtros, selección de documentos y apertura del detalle con doble clic o Mostrar/F4. La interfaz utiliza el diseño y los contratos propios de POSMYCLETH.

Referencia consultada: [Manual público de SICAR, sección Consultar Venta](https://manual.sicar.mx/ventas/), consultado el 10 de noviembre de 2026. La referencia se limita al comportamiento públicamente documentado.

## 2. Alcance funcional

### Listado

- Acceso desde la opción Ventas del menú administrativo.
- Tabla con folio, fecha, cliente, sucursal, almacén, usuario, condición de pago, estado y total.
- Selección de una venta mediante un control de radio o clic en la fila.
- Apertura con Ver detalle, doble clic o Mostrar/F4.
- Paginación del servidor y elección del número de registros por página.
- Búsqueda por folio completo o parcial.
- Filtros por fecha inicial, fecha final, estado y condición de pago.
- Acciones Buscar ventas, Limpiar y Actualizar.
- Estados de carga, consulta fallida, acceso restringido, lista vacía y página sin documentos.

### Detalle

El detalle se presenta en un diálogo, con estas secciones:

1. **General:** cliente, sucursal, almacén, usuario, caja asociada, subtotal, descuentos, impuestos, total y observaciones.
2. **Artículos:** descripción, SKU, cantidad, precio unitario, descuento, impuesto e importe de cada renglón.
3. **Pagos y devoluciones:** pagos originales, referencias, resumen de devoluciones, estado financiero, importes devueltos o revertidos, venta y pagos netos, efectivo neto y crédito registrado cuando corresponda.

Los filtros y la página se conservan en la URL al abrir y cerrar un documento. Es posible acceder directamente a la ruta de detalle.

## 3. Límites de esta entrega

Esta entrega no registra ventas, cobros, cancelaciones, devoluciones, cambios de vendedor, comentarios, facturas ni envíos de correo. Tampoco implementa impresión o exportación.

El buscador inicial consulta el folio. No simula una búsqueda global por nombre de cliente o artículo mediante el filtrado de una sola página. La API de ventas admite algunos filtros adicionales por identificadores, pero esta interfaz no incorpora todavía sus selectores.

El crédito mostrado corresponde a los importes registrados y al resumen que devuelve el backend. El seguimiento de abonos y cuentas por cobrar no está integrado en el contrato actual.

Las consultas del backend inspeccionadas se delimitan por la empresa del usuario autenticado. El filtro opcional de sucursal del contrato no sustituye una regla de autorización por sucursal.

## 4. Tecnologías y reutilización

- React 19, TypeScript y Vite 8.
- React Router 8 para las rutas y parámetros de consulta.
- Fetch API mediante el cliente existente `apiRequest`.
- `AbortController` para cancelar solicitudes que dejaron de ser necesarias.
- `Intl.NumberFormat` y `Intl.DateTimeFormat` para presentar importes, cantidades y fechas.
- Elemento HTML nativo `dialog` para el detalle modal.
- CSS del módulo para la tabla, filtros, diálogo y adaptación responsiva.
- Herramientas de prueba incluidas en Node.js.

Se reutilizan `DashboardLayout`, la sesión de autenticación y el cliente HTTP existentes. No se instalaron dependencias ni se cambiaron manifiestos o archivos de bloqueo para desarrollar este módulo.

## 5. Archivos del módulo

Las rutas de esta tabla son relativas a la raíz del repositorio.

| Archivo | Responsabilidad |
|---|---|
| [AppRouter.tsx](../../apps/web/src/app/router/AppRouter.tsx) | Integra las rutas protegidas de listado y detalle. |
| [navigation.config.ts](../../apps/web/src/app/navigation/navigation.config.ts) | Activa el destino de Ventas con su permiso. |
| [SalesPage.tsx](../../apps/web/src/pages/SalesPage.tsx) | Coordina filtros, selección, resultados, paginación y apertura del documento. |
| [SalesPage.css](../../apps/web/src/pages/SalesPage.css) | Presentación visual y comportamiento responsivo. |
| [sales.types.ts](../../apps/web/src/features/sales/sales.types.ts) | Tipos de documentos, artículos, pagos, paginación y resumen financiero. |
| [sales.query.ts](../../apps/web/src/features/sales/sales.query.ts) | Lectura y validación de filtros, construcción de consultas y formatos de presentación. |
| [sales.service.ts](../../apps/web/src/features/sales/sales.service.ts) | Consultas a los tres endpoints de ventas utilizados. |
| [useSales.ts](../../apps/web/src/features/sales/useSales.ts) | Estados de las solicitudes, cancelación y tratamiento de errores. |
| [SalesFilters.tsx](../../apps/web/src/features/sales/SalesFilters.tsx) | Formulario y validación de filtros. |
| [SalesTable.tsx](../../apps/web/src/features/sales/SalesTable.tsx) | Tabla, selección y acceso al detalle. |
| [SaleDetail.tsx](../../apps/web/src/features/sales/SaleDetail.tsx) | Diálogo con las secciones General, Artículos y Pagos/devoluciones. |
| [sales-query.test.mjs](../../apps/web/tests/sales-query.test.mjs) | Pruebas aisladas de consultas, fechas e identificadores. |

La documentación de esta entrega se encuentra en este archivo y en el [índice frontend](README.md).

## 6. Rutas y contratos

### Rutas del frontend

| Ruta | Función |
|---|---|
| `/sales` | Listado y filtros. |
| `/sales/:saleId` | Detalle sobre el listado. |

Una sesión ausente redirige al acceso. El módulo comprueba `VENTAS.VER` antes de mostrar el contenido y solicitar datos.

### Consultas del backend

Las tres consultas requieren un JWT Bearer válido y `VENTAS.VER`.

| Método | Endpoint | Uso |
|---|---|---|
| GET | `/api/v1/sales` | Documentos y paginación. |
| GET | `/api/v1/sales/:id` | Información general, artículos, pagos y resumen de devoluciones. |
| GET | `/api/v1/sales/:id/financial-summary` | Importes originales, devueltos, revertidos y netos; estado financiero y crédito. |

El listado utiliza `page`, `limit`, `folio`, `fecha_desde`, `fecha_hasta`, `estado` y `condicion_pago`. La respuesta contiene `ok`, `data` y `pagination`, con `page`, `limit`, `total` y `totalPages`.

Los identificadores se conservan como cadenas. La interfaz valida identificadores positivos dentro del rango BIGINT firmado, evitando convertirlos a números que pierdan precisión.

El servicio comprueba la estructura mínima de las respuestas antes de utilizarlas. Los datos y reglas definitivos se obtienen del backend.

## 7. Fechas, importes y reglas de consulta

- Se validan fechas de calendario reales y el orden del intervalo.
- La fecha inicial y final pueden utilizarse de forma independiente.
- El filtro de ventas no hereda la restricción de 31 días del dashboard.
- El backend interpreta las fechas de día completo del contrato en UTC. La interfaz presenta sus fechas y horas en UTC y lo indica en los filtros.
- Los importes se muestran con dos decimales, sin asumir un código de moneda que la respuesta de ventas no proporciona.
- Las cantidades de artículos se presentan con hasta tres decimales.
- El frontend no recalcula los importes financieros ni interpreta el crédito registrado como un saldo de cuentas por cobrar.
- Las cifras de la tabla corresponden a los documentos devueltos por la consulta; no se inventan totales globales a partir de una página.

## 8. Flujo de funcionamiento

1. El usuario inicia sesión mediante el mecanismo existente.
2. El router permite el acceso a la estructura administrativa.
3. Ventas verifica el permiso y lee los filtros de la URL.
4. Si los parámetros son válidos, el hook solicita el listado al servicio.
5. El servidor devuelve los documentos y su paginación.
6. La selección permite abrir un documento mediante botón, doble clic o F4.
7. El detalle y el resumen financiero se consultan de forma independiente.
8. El diálogo presenta los datos y permite cambiar entre sus secciones.
9. Al cerrar, se conserva la consulta y el navegador restaura el foco.
10. Un cambio de filtros o de página genera una nueva solicitud y descarta respuestas anteriores.

El atajo F4 se limita a la sección de Ventas y evita intervenir cuando se editan filtros o se utiliza el diálogo.

## 9. Seguridad, errores y accesibilidad

El backend conserva la responsabilidad de la autenticación, autorización y delimitación de los datos. La ocultación del menú y las comprobaciones de interfaz son controles de presentación adicionales.

- HTTP 401 limpia la sesión local correspondiente a la solicitud, sin invalidar una sesión posterior por una respuesta atrasada.
- HTTP 403 presenta acceso restringido.
- HTTP 404 en el detalle informa que el documento no existe o no está disponible.
- Otros fallos permiten reintentar la consulta.
- Un fallo del resumen financiero no impide consultar los datos generales ni los pagos originales.
- Los cambios de consulta cancelan las solicitudes anteriores y los resultados se asocian con la consulta y sesión que los originaron.
- La tabla cuenta con encabezados, selección identificada y un botón de detalle por documento.
- Los filtros tienen etiquetas y los estados relevantes incluyen mensajes accesibles.
- El diálogo nativo mantiene el foco dentro mientras está abierto y permite cerrar mediante Escape o el botón correspondiente.
- En móvil, el detalle ocupa la pantalla y las tablas permiten desplazamiento horizontal dentro de su contenedor.

El cierre del diálogo se realiza antes de cambiar de ruta para evitar que la restauración del foco interfiera con la interacción posterior.

## 10. Validación técnica

Ejecutada desde `apps/web`, con las dependencias existentes:

```bash
npm run build
npm run lint
node --test tests/sales-query.test.mjs
```

| Comprobación | Resultado registrado |
|---|---|
| TypeScript y compilación Vite | Correctos. |
| ESLint | Sin errores. |
| Pruebas aisladas | 7 aprobadas; 0 fallidas. |
| Revisión de espacios del diff en rutas y navegación | Sin errores. |

Las pruebas aisladas cubren:

1. Conservación de filtros y caracteres especiales, con exclusión de parámetros ajenos.
2. Fechas reales, años bisiestos y orden del intervalo.
3. Límites de fecha independientes.
4. Rechazo de paginación inválida.
5. Preservación de precisión y validación de identificadores BIGINT.
6. Estados y condiciones de pago admitidos por la interfaz.
7. Presentación coherente de fechas UTC.

Estas pruebas se complementaron con comprobaciones de navegador; no sustituyen por sí solas la validación funcional.

## 11. Pruebas funcionales con respuestas simuladas

Se utilizó un servidor temporal local, con datos ficticios y sin conexión al backend real. Se comprobaron:

- Listado, selección, doble clic, F4, paginación y búsqueda por folio.
- Conservación de filtros al abrir y cerrar.
- Artículos, pagos, crédito, cancelaciones y devoluciones.
- Tab, Shift+Tab y Escape dentro del diálogo.
- Consulta vacía, error del servidor, falta de permiso y sesión expirada.
- Documento inexistente y parámetros de consulta inválidos.
- Fallo independiente del resumen financiero.
- Respuestas atrasadas frente a una consulta posterior.
- Presentación en escritorio y en un viewport móvil de 390 por 844 píxeles.

La sesión de prueba registró 90 solicitudes simuladas, ninguna de escritura. El escenario sin permiso no produjo solicitudes de ventas. La pestaña y el servidor temporal se cerraron al finalizar.

Las comprobaciones negativas de permisos y errores se realizaron en este entorno simulado; no se probaron todas las combinaciones de roles sobre la base real.

## 12. Validación contra el backend real

Se utilizó la configuración existente y una cuenta con acceso proporcionada por el desarrollador. El inicio de sesión fue realizado manualmente por él.

Para aislar la prueba, la API se levantó temporalmente sin iniciar el worker de sincronización. La entrada temporal permitió consultas de autenticación, dashboard y ventas, además del acceso manual. Las escrituras de negocio permanecieron bloqueadas. No se modificaron archivos del backend.

| Caso | Resultado observado el 10 de noviembre de 2026 |
|---|---|
| Listado inicial | 38 ventas existentes. |
| Segunda página, 20 por página | 18 documentos. |
| Estado CANCELADA | 18 documentos cancelados; ningún documento completado en ese resultado. |
| Fechas del 2 de octubre de 2026 en UTC | 11 documentos. |
| Mismas fechas y condición CREDITO | 2 documentos. |
| Folio completo seleccionado del listado | 1 documento. |
| Folio sin coincidencias | Estado vacío correcto. |
| Tamaño de página 10 | 10 filas y 4 páginas. |
| Venta a crédito con devolución total | Artículos y pagos correctos; venta y pagos netos en cero. |
| Venta cancelada | Reversión mostrada y venta/pagos netos en cero. |
| Fecha inicial posterior a la final, usando teclado | Error de validación visible. |
| Detalle móvil con folio largo | Adaptación a 390 píxeles y contenido consultable. |

El registro de la entrada temporal contabilizó 27 solicitudes: 21 consultas de ventas, un inicio de sesión y las consultas auxiliares restantes. Sus respuestas fueron 20 HTTP 200 y 7 HTTP 304. No se registraron escrituras de ventas.

El acceso manual registra la actividad habitual de la cuenta; la afirmación de ausencia de escrituras se refiere a las operaciones de negocio de ventas, no a los efectos normales de autenticación.

No aparecieron errores ni advertencias en la consola durante las comprobaciones finales. La pestaña y ambos servidores temporales se cerraron después de la validación.

Estas cantidades describen el conjunto de datos observado en esa fecha; no son valores fijos del sistema ni indicadores de producción.

## 13. Evidencias y control de versiones

Se conservaron capturas locales del listado y del detalle en escritorio y móvil, para el entorno simulado y para el backend real. Las capturas y registros temporales no forman parte del código ni se incorporaron al repositorio.

Esta entrega modificó la integración de rutas y navegación y añadió los archivos del módulo y sus pruebas. Los cambios previos ajenos se mantuvieron separados.

Al documentar el cierre:

- No se prepararon archivos en Git.
- No se creó un commit del módulo.
- No se realizó push ni PR.
- El documento maestro v1.1 permaneció íntegro.
- Las reglas y el contexto personal permanecieron locales.

El commit del módulo requiere revisión de los archivos, autoría, atribuciones y aprobación explícita del desarrollador.

## 14. Resultado y continuidad

El desarrollador confirmó el cierre funcional de Ventas: listado y detalle después de las comprobaciones técnicas, aisladas y contra la API real.

La siguiente ampliación del área de Ventas deberá definir su propio alcance: captura de ventas/POS, integración de caja, cobros u operaciones posteriores. Esta entrega conserva la base de consulta y no da por implementadas esas operaciones.

La documentación aporta evidencia de integración, validación, decisiones de interfaz y resultados para los apartados de procedimiento y resultados del informe técnico de residencia, manteniendo separado el informe académico.
