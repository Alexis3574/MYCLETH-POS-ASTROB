# M17 — Reportes API

## Proyecto

POSMYCLETH.

Backend:
- TypeScript
- Express
- Prisma
- PostgreSQL

Base de pruebas: pos_novnix.

## Estado

API funcional implementada y validada.

M17 es el ultimo modulo previsto en la
secuencia de desarrollo del backend.

## Rutas

Prefijo:

`/api/v1/reports`

Reportes JSON:

- GET /ventas
- GET /devoluciones
- GET /compras
- GET /inventario
- GET /existencias
- GET /caja

Exportaciones CSV:

- GET /ventas/export.csv
- GET /devoluciones/export.csv
- GET /compras/export.csv
- GET /inventario/export.csv
- GET /existencias/export.csv
- GET /caja/export.csv

Las rutas anteriores son relativas
al prefijo /api/v1/reports.

## Autorizacion

Todas las operaciones requieren:

- JWT valido.
- Usuario activo y no bloqueado.
- Empresa activa.
- REPORTES.VER.
- Permiso de lectura del modulo correspondiente.

Permisos por categoria:

- Ventas: VENTAS.VER
- Devoluciones: VENTAS.VER
- Compras: COMPRAS.VER
- Inventario: INVENTARIO.VER
- Existencias: INVENTARIO.VER
- Caja: CAJAS.VER

En la base de pruebas, REPORTES.VER
esta asignado a ADMIN y SUPERVISOR.

El acceso se valida en cada solicitud.

## Aislamiento

Se restringen los registros por:

- Empresa autenticada.
- Sucursales autorizadas.
- Sucursal solicitada, cuando corresponda.
- Relaciones empresariales de documentos.

Los usuarios sin sucursales autorizadas
no reciben datos de las sucursales.

No se confia en IDs empresariales
suministrados como parametros.

## Filtros

Las consultas historicas aceptan:

- fecha_desde: YYYY-MM-DD
- fecha_hasta: YYYY-MM-DD
- sucursal_id: BIGINT positivo

Filtros adicionales segun el reporte:

Ventas:
- estado
- condicion_pago
- folio

Devoluciones:
- folio

Compras:
- estado
- proveedor_id

Inventario:
- almacen_id
- producto_id
- tipo

Existencias:
- almacen_id
- producto_id

Caja:
- sesion_caja_id
- tipo

Los filtros desconocidos son rechazados.

## Paginacion

- page predeterminado: 1.
- limit predeterminado: 20.
- maximo limit: 100.

El resultado JSON incluye:
- data
- pagination
- tipo
- moneda
- periodo
- sucursal_id

## Periodos

Las consultas historicas usan la zona
horaria configurada en la empresa.

Periodo predeterminado: 30 dias calendario.

Periodo maximo: 366 dias calendario
incluyendo ambos extremos.

El reporte de existencias es una
fotografia del inventario actual.

## Consideraciones financieras

Los reportes de ventas presentan
documentos y estados originales.

Una venta cancelada puede aparecer
en el listado historico, pero no
debe interpretarse como ingreso valido.

Las devoluciones se consultan por
su propia fecha y relacion con ventas.

Una venta a credito no implica
necesariamente efectivo cobrado.

Los reportes de movimientos de caja
no reemplazan las reglas de cierre
ni conciliacion de sesiones.

Los reportes de movimientos de inventario
no equivalen al saldo historico de existencias.

## Exportaciones CSV

- Codificacion UTF-8 con BOM.
- Encabezados estables.
- Escapado de comillas y separadores.
- Proteccion contra formulas.
- Proteccion adicional contra caracteres
  Unicode invisibles.
- Mismos filtros y permisos que JSON.
- Limite de 3000 registros.
- Rechazo HTTP 413 si se excede el limite.
- Cache-Control: private, no-store.

El CSV es compatible con herramientas
de hojas de calculo.

No se incorpora una dependencia XLSX
en esta implementacion.

## Validaciones realizadas

TypeScript:
- Sin errores.

Pruebas unitarias:
- 13 aprobadas.

Integracion HTTP y CSV:
- 22 aprobadas.

Seguridad avanzada:
- 10 aprobadas.
- 1 omitida por falta de escenario real.

Total:
- 45 pruebas aprobadas.
- 0 errores.
- 1 prueba omitida.

Se verificaron:
- Autenticacion JWT.
- Permisos efectivos.
- Restricciones por sucursal.
- Validadores de parametros.
- Conteos independientes de Prisma.
- Paginacion.
- JSON y CSV de seis reportes.
- Exportaciones con cero registros.
- CSV UTF-8 y neutralizacion de formulas.
- Ausencia de escrituras en tablas verificadas.

## Datos verificados

En el periodo de pruebas:

- Ventas: 38.
- Devoluciones: 17.
- Compras: 0.
- Movimientos de inventario: 76.
- Existencias actuales: 1.
- Movimientos de caja: 13.

Estos conteos corresponden
a datos de prueba y pueden cambiar.

## Pendientes de validacion

- Aislamiento con dos empresas reales.
- Usuario no administrador con permisos
  de reportes y sucursales parcialmente
  autorizadas para probar denegacion real.
- Pruebas de carga con grandes volumenes.
- Prueba real del limite de 3000 registros
  de exportacion bajo alta carga.
- Validacion positiva de compras cuando
  existan documentos en la base.
- Integracion con el frontend.
- Evaluacion futura de exportacion XLSX.

Estos escenarios no se consideran aprobados.

## Restricciones del cierre

- Sin nuevas tablas.
- Sin migraciones Prisma.
- Sin nuevos paquetes.
- Sin respaldos de PostgreSQL.
- Sin modificacion de modulos ajenos.

## Estado general

M17 queda implementado como modulo
funcional de reportes, sujeto a los
pendientes de validacion documentados.

El cierre de M17 no sustituye las
pruebas funcionales pendientes de
Productos/Catalogo e Inventario.
