# Frontend — Caja avanzada: avance

Fecha: 22 de noviembre de 2026, America/Mexico_City.

Estado: **IMPLEMENTADO Y VALIDADO CON SIMULADOR; CONSULTAS REALES VERIFICADAS. ESCRITURAS REALES DE CAJA Y CIERRE DEL DESARROLLADOR PENDIENTES.**

## Alcance implementado

La ruta existente `/cash` sustituye la consulta básica por selección de caja, sesión actual, detalle de sesión, historial paginado, movimientos paginados, apertura, entradas y salidas manuales y conteo de efectivo antes del cierre. Reutiliza autenticación, navegación, permisos, cliente HTTP, recursos remotos, paginación, mensajes y estilos existentes.

El conteo muestra el efectivo esperado y la diferencia estimada. Al confirmar el cierre, el backend vuelve a calcular el esperado y guarda contado, esperado, diferencia, usuario, fecha y auditoría. No hay un endpoint de arqueos independientes: esta pantalla conserva el conteo como parte del cierre. Las fechas se presentan explícitamente en UTC.

No se modificaron backend, Prisma, migraciones, permisos, dependencias, autenticación ni el selector de sesión que utilizan POS y devoluciones. No se incorporaron altas o edición del catálogo de cajas, reaperturas, cancelaciones de movimientos, denominaciones, impresión ni arqueos separados del cierre.

## Contratos comprobados en el código vigente

Todas las rutas utilizan el prefijo `/api/v1` y la sesión autenticada. Los identificadores BIGINT se conservan como cadenas. La respuesta de caja tiene forma `{ok:true,data:...}`; los listados contienen `items`, `total`, `page`, `pageSize`.

| Acción | Ruta | Permiso | Captura |
| --- | --- | --- | --- |
| Cajas disponibles | GET `/cash` | `CAJAS.VER` | Página de cajas asignadas a las sucursales del usuario |
| Sesión actual | GET `/cash/:cashId/sessions/current` | `CAJAS.VER` | Puede devolver `null` |
| Historial | GET `/cash/:cashId/sessions` | `CAJAS.VER` | Paginación de 20 registros |
| Detalle y balance | GET `/cash/sessions/:sessionId` | `CAJAS.VER` | Incluye caja, esperado actual y sumas por tipo |
| Movimientos | GET `/cash/sessions/:sessionId/movements` | `CAJAS.VER` | Paginación de 20 registros |
| Apertura | POST `/cash/:cashId/sessions` | `CAJAS.ABRIR` | `monto_apertura`, `notas` |
| Entrada o salida | POST `/cash/sessions/:sessionId/movements` | `CAJAS.MOVER` | `tipo`, `concepto`, `monto`, `referencia` |
| Cierre | POST `/cash/sessions/:sessionId/close` | `CAJAS.CERRAR` | `monto_cierre`, `notas` |

La apertura requiere una caja activa sin sesión abierta. Los movimientos y el cierre requieren que la sesión siga abierta, la caja esté activa y el usuario autenticado sea quien abrió la sesión. El frontend consulta de nuevo estas condiciones antes del envío; el backend mantiene la autoridad y sus bloqueos transaccionales.

Los importes capturados admiten hasta 12 enteros y dos decimales, sin exponentes o separadores de miles. Apertura y cierre permiten cero; los movimientos deben ser positivos. Los cálculos de captura y diferencias utilizan centavos enteros. El concepto admite 3 a 180 caracteres; la referencia, 3 a 105; las notas, hasta 1500.

Al revisar un movimiento sin referencia propia, se genera una UUID y se conserva al volver a editar. El backend guarda `MANUAL:<referencia>` y rechaza referencias repetidas en la sesión con 409; no devuelve la respuesta original como un reintento idempotente. Una salida no puede superar el efectivo esperado. Las notas de cierre vacías envían `null`, con lo que el backend conserva las notas anteriores.

## Protección del intento y recuperación

La confirmación presenta caja, sesión, importe, concepto/referencia o notas y, para cierre, esperado y diferencia estimados. Volver a editar conserva la captura. El envío tiene bloqueo síncrono para evitar doble clic. Si se abandona la pantalla antes de finalizar las consultas previas, no se envía el POST después del desmontaje.

Antes de cada POST se guarda el intento en `sessionStorage` bajo `posmycleth.cash.action.pending.v1`, con empresa, usuario y solicitud. No contiene credenciales ni tokens. Si el almacenamiento no está disponible o está dañado, la captura queda bloqueada. La respuesta se valida y se compara con el intento antes de retirar la protección.

Una respuesta de red incierta, 408, 409, 5xx o un 2xx incompleto conserva el bloqueo, incluso al recargar. No hay reenvíos automáticos. La acción «Comprobar operación de caja» utiliza solo GET:

- Apertura: requiere un registro posterior al máximo ID del historial completo previo, misma caja, propietario, fondo y notas.
- Movimiento: exige sesión, usuario, referencia `MANUAL:`, tipo, concepto e importe coincidentes.
- Cierre: exige la sesión cerrada, usuario de cierre, conteo y notas correspondientes.

La conciliación exige una única coincidencia. Recorre todas las páginas, detecta cambios de total/duplicados y limita la consulta a 500 páginas de 20 registros. Si no logra comprobar el historial completo, no interpreta el resultado como ausencia. Un usuario distinto no puede verificar ni liberar el intento de otra identidad. Existe liberación manual tras revisión expresa; no constituye una prueba de que un POST anterior no siga ejecutándose.

Esta protección pertenece a la pestaña y su almacenamiento de sesión. No sustituye idempotencia transaccional del servidor entre pestañas, dispositivos o sesiones. Una apertura que posteriormente cambie sus notas puede necesitar revisión manual para conciliarla. No se afirma cobertura completa de concurrencia mediante un simulador.

## Archivos

- `apps/web/src/features/cash/CashWorkspace.tsx`: selección, recursos, permisos, historial y estados.
- `apps/web/src/features/cash/CashActionForm.tsx`: captura, arqueo y confirmación.
- `apps/web/src/features/cash/useCashMutation.ts`: consulta previa, envío único y conciliación.
- `apps/web/src/features/cash/cash.types.ts`, `cash.logic.ts`, `cash.parse.ts`, `cash.history.ts`, `cash.service.ts`: contratos, centavos, validación, almacenamiento y API.
- `apps/web/src/features/cash/cash.css`: presentación adaptable.
- `apps/web/src/pages/CommercialPages.tsx`: integración en Caja.
- `apps/web/tests/cash.test.mjs`, `cash-fixture-state.mjs`, `cash-browser-fixture.mjs`: pruebas y simulador independiente de PostgreSQL.

## Validaciones ejecutadas

`npm run build`: TypeScript y Vite correctos, 158 módulos. `npm run lint`: correcto. `node --experimental-strip-types --test tests/*.test.mjs`: **60 pruebas correctas, 0 fallidas**, incluidas 13 nuevas de caja. Las pruebas comprueban centavos, límites, contratos malformados, BIGINT, coincidencias completas, almacenamiento, paginación, sesión ajena, permisos, cierre y errores posteriores al registro.

Pruebas de navegador sobre el simulador aislado en `http://127.0.0.1:5181/cash`:

1. Apertura de 500.00; volver a editar conserva el importe.
2. Entrada de 100.20 con referencia automática. Retiro de 601 rechazado cuando el esperado era 600.20.
3. Salida válida de 50.10; esperado 550.10. Conteo 550.00; cierre e historial con diferencia -0.10. El ciclo completo se repitió con el código final.
4. Respuesta 503 después de registrar apertura, movimiento y cierre; bloqueo persistente tras recarga y recuperación por GET. Un registro por operación. Tras el ajuste de navegación se repitió la recuperación de movimiento.
5. Usuario de solo consulta, sesión ajena y caja inactiva: sin botones de mutación. Usuario sin `CAJAS.VER`: acceso rechazado. Historial malformado: error explícito.
6. Historial de 22 movimientos: segunda página con dos registros.
7. Pantalla móvil de 390 × 844: confirmación legible, ancho del documento 390 sin desbordamiento global. Tamaño restablecido al terminar.
8. Consulta previa demorada: salir a Productos antes del envío terminó con cero POST y cero movimientos en el escenario.

Al añadir un hook durante el desarrollo, Vite produjo un error transitorio de orden de hooks en la pestaña ya cargada. Se recargó completamente antes de validar el código final. La pestaña nueva de revisión terminó sin errores ni advertencias de consola. Los HTTP 503 de los escenarios de incertidumbre son deliberados.

## Consultas reales y límites de validación

Se consultaron caja 1, sesión actual 1, detalle, historial y 13 movimientos existentes en PostgreSQL local `pos_novnix`, mediante la API autenticada y una envoltura que bloquea las escrituras de negocio. Fondo 500.00; entradas acumuladas 6679.70; salidas 6679.70; esperado actual 500.00. La sesión pertenece al usuario de apertura 3 y el usuario conectado es distinto; tampoco tiene permisos de movimiento/cierre. La interfaz no ofreció operaciones indebidas. No se alteraron permisos ni se cambió el propietario.

Estas consultas no validan apertura, movimientos o cierre reales desde la nueva pantalla. La siguiente prueba real requiere usuario y permisos adecuados, autorización específica de caja, cantidades, referencias y efectos de auditoría. No debe cerrarse la sesión histórica existente como limpieza de pruebas. No se crearon ni modificaron registros reales de caja en esta etapa.

El ciclo autorizado de POS/devolución se completó antes de Caja avanzada: venta 83, devolución 21, total 1135.94, neto 0, stock inicial/final 1.000. Se detuvo la envoltura de escritura después de comprobarlo. No se ejecutó el worker ni se enviaron sincronizaciones externas.

## Repetir la revisión aislada

```powershell
cd C:\Users\taiga\Documentos\POSMYCLETH\apps\web
node tests/cash-browser-fixture.mjs
```

Abrir `http://127.0.0.1:5181/cash`. El proceso usa datos en memoria; reiniciarlo los restablece. No importa la API real, no carga `.env` ni configura proxy. El comando `stop` en esa terminal cierra el simulador. Los escenarios se eligen con `?fixture=read-only`, `other-owner`, `inactive`, `no-permission`, `malformed`, `paged`, `fault-open`, `fault-move`, `fault-close`, `reject-open` o `slow-preflight`. Cada escenario tiene datos independientes. La ruta GET `/__qa/cash` muestra únicamente contadores y solicitudes sintéticas para verificar duplicados.

Pendientes: pruebas reales expresamente autorizadas con un operador propio; interacciones reales de efectivo entre POS, devoluciones y caja; concurrencia real y revisión del desarrollador para cerrar el módulo. Este archivo es un informe de avance, no documentación de cierre.

No hubo staging, commits, push ni PR. No se instalaron dependencias. Se conservaron los cambios previos y se verificaron sin cambios los hashes de `AGENTS.md` y del contexto maestro frontend v1.1. Las evidencias visuales y los ayudantes temporales permanecen fuera del repositorio.
