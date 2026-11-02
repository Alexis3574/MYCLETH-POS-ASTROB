# M16 — Dashboard API

## Estado

Versión funcional completada.

Proyecto: POSMYCLETH.
Backend: Express, TypeScript, Prisma y PostgreSQL.
Base de pruebas: pos_novnix.

## Endpoint

GET /api/v1/dashboard/summary

Parámetros opcionales:
- fecha_desde: YYYY-MM-DD
- fecha_hasta: YYYY-MM-DD
- sucursal_id: identificador BIGINT positivo

Se admite un máximo de 31 días por consulta.

Sin fechas explícitas, se utiliza un periodo de
siete días considerando la zona horaria empresarial.

## Seguridad

Requiere JWT y DASHBOARD.VER.

Se aplican además permisos individuales:
- VENTAS.VER
- CAJAS.VER
- INVENTARIO.VER
- ECOMMERCE_SYNC.VER

Un indicador solamente se devuelve cuando el
usuario dispone del permiso correspondiente.

Se verifica:
- Usuario activo.
- Empresa activa.
- Empresa del JWT.
- Sucursales autorizadas.
- Permisos efectivos de roles activos.

La sucursal solicitada debe pertenecer a la
empresa y estar dentro del alcance autorizado.

## Indicadores

### Ventas

- Operaciones completadas.
- Ventas brutas.
- Devoluciones registradas.
- Importe devuelto.
- Ventas netas.
- Ticket promedio bruto.
- Tendencia diaria.

Se excluyen ventas canceladas.

Las devoluciones se descuentan según su fecha
y solamente cuando corresponden a ventas
completadas.

Los importes se expresan como cadenas
decimales de dos posiciones.

### Caja

- Cajas activas.
- Sesiones abiertas.

Representa el estado operativo actual.
No es una serie histórica del periodo solicitado.

### Inventario

- Existencias registradas.
- Existencias bajo mínimo.
- Existencias agotadas.

Se utilizan existencias disponibles de productos
activos que controlan inventario, en almacenes
y sucursales activos.

Se contabilizan registros por producto y almacén.
No se contabilizan productos sin registro de
existencia como agotados.

Representa el estado actual, no histórico.

### Ecommerce

- Sincronizaciones pendientes o con estado distinto
  de SINCRONIZADO.

Visible solamente con ECOMMERCE_SYNC.VER.

Su integración contempla el estado actual.
No se ha probado con un usuario real autorizado
para ese permiso.

## Módulos no incluidos

Compras, pedidos de clientes y cotizaciones no
forman parte de los indicadores principales.

Los análisis extensos y las exportaciones
corresponderán al M17 — Reportes API.

## Validaciones realizadas

- TypeScript sin errores.
- 8 pruebas unitarias.
- 15 pruebas HTTP y financieras.
- 7 pruebas de seguridad.
- Autenticación JWT.
- Permisos individuales.
- Restricción por sucursal.
- Validación de fechas.
- Comparación financiera contra Prisma.
- Verificación de tendencias diarias.
- Consultas sin modificaciones de datos.

## Referencia histórica validada

Periodo: 2026-09-25 a 2026-10-03.

- Ventas completadas: 20.
- Ventas brutas: 23854.74 MXN.
- Devoluciones: 19310.98 MXN.
- Ventas netas: 4543.76 MXN.

Son datos históricos de pruebas,
no resultados correspondientes al día actual.

## Pendientes

- Prueba de aislamiento entre dos empresas reales.
- Prueba con varias sucursales y usuarios asignados.
- Prueba positiva de Ecommerce con permiso real.
- Pruebas de rendimiento y carga.
- Validaciones con grandes volúmenes de datos.
- Integración del frontend con el Dashboard.

No se realizaron migraciones para M16.

## Cierre

M16 cerrado como API funcional de indicadores
ejecutivos y operativos, con pendientes documentados.

M17 — Reportes API será el módulo siguiente.
