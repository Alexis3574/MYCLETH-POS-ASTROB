# Módulo Frontend: Dashboard Operativo

## 1. Descripción general

El Dashboard Operativo de POSMYCLETH proporciona una vista
consolidada de los indicadores comerciales y operativos
de la empresa autenticada.

Consume información real de la API REST del sistema,
respetando los permisos del usuario y las sucursales
a las que tiene acceso.

## 2. Objetivo

Facilitar la consulta de información empresarial mediante
indicadores, filtros de fechas, gráficas y tablas.

El módulo permite visualizar el desempeño comercial sin
modificar directamente los registros de la base de datos.

## 3. Tecnologías utilizadas

- React 19
- TypeScript
- Vite 8
- CSS
- Fetch API mediante el cliente HTTP existente
- React Hooks
- Intl para formato de números, monedas y fechas

No se incorporaron dependencias adicionales para
implementar las gráficas y los filtros.

## 4. Arquitectura del frontend

Archivos principales:

- apps/web/src/features/dashboard/dashboard.types.ts
- apps/web/src/features/dashboard/dashboard.service.ts
- apps/web/src/features/dashboard/useDashboardSummary.ts
- apps/web/src/pages/DashboardPage.tsx
- apps/web/src/pages/DashboardPage.css

### Responsabilidades

dashboard.types.ts:
Define las interfaces TypeScript del contrato de la API.

dashboard.service.ts:
Realiza las solicitudes HTTP reutilizando apiRequest.

useDashboardSummary.ts:
Gestiona la consulta, carga, errores, actualización
y cancelación de solicitudes obsoletas.

DashboardPage.tsx:
Presenta los filtros, indicadores, gráfica y tabla diaria.

DashboardPage.css:
Contiene los estilos responsivos del módulo.

## 5. Integración con el backend

Método: GET

Endpoint:

/api/v1/dashboard/summary

Autenticación:
JWT Bearer.

Permiso principal:
DASHBOARD.VER.

### Parámetros disponibles

- fecha_desde: fecha YYYY-MM-DD
- fecha_hasta: fecha YYYY-MM-DD
- sucursal_id: identificador positivo opcional

El frontend implementa filtros por fechas.
El filtrado visual por sucursal queda disponible
para una etapa posterior.

El backend admite intervalos de hasta 31 días
naturales, incluyendo ambas fechas.

Sin filtros, consulta los últimos siete días
según la zona horaria configurada en la empresa.

## 6. Datos recibidos

La API devuelve:

- periodo
- sucursal_id
- indicadores

El periodo contiene las fechas consultadas,
la zona horaria de la empresa y la moneda.

Los indicadores son opcionales según los permisos.

### 6.1 Ventas

Permiso: VENTAS.VER.

- Operaciones completadas
- Devoluciones registradas
- Ventas brutas
- Monto devuelto
- Ventas netas
- Ticket promedio
- Tendencia diaria

Las ventas netas corresponden a ventas brutas
menos el monto devuelto.

El ticket promedio es calculado por el backend
a partir de las ventas brutas y las operaciones.

### 6.2 Caja

Permiso: CAJAS.VER.

- Cajas activas
- Sesiones abiertas

### 6.3 Inventario

Permiso: INVENTARIO.VER.

- Existencias registradas
- Existencias bajo mínimo
- Existencias agotadas

### 6.4 E-commerce

Permiso: ECOMMERCE_SYNC.VER.

- Sincronizaciones pendientes o con error

Esta consulta es informativa.
El dashboard no activa la sincronización.

## 7. Flujo de funcionamiento

1. El usuario inicia sesión.
2. El sistema obtiene el JWT y sus permisos.
3. Se accede a la ruta protegida /dashboard.
4. El frontend comprueba DASHBOARD.VER.
5. El hook consulta el resumen mediante el servicio.
6. El backend valida la identidad y los permisos.
7. La API obtiene los indicadores autorizados.
8. El frontend presenta los datos recibidos.
9. Los filtros permiten modificar el periodo.
10. El botón Actualizar vuelve a solicitar el resumen.

## 8. Filtros implementados

- Hoy
- Últimos 7 días
- Últimos 30 días
- Periodo personalizado
- Restablecer filtros
- Actualizar información

Los filtros rápidos toman como referencia
la zona horaria proporcionada por la API.

Los periodos personalizados requieren fechas válidas,
ordenadas y dentro del límite permitido.

## 9. Visualización de indicadores

Los datos se presentan mediante tarjetas responsivas.

Las cifras monetarias se formatean según la moneda
devuelta por el backend.

La tendencia diaria compara:

- Ventas brutas
- Devoluciones

También se presenta una tabla detallada
con ventas netas por día.

La tabla permanece plegada inicialmente
y puede expandirse cuando el usuario lo requiera.

Cuando los importes diarios son cero,
se presenta un mensaje informativo en lugar
de una gráfica vacía.

## 10. Manejo de errores

El módulo contempla:

- Estado de carga
- Consulta exitosa
- Acceso restringido
- Error de comunicación
- Reintento de solicitudes
- Ausencia de indicadores autorizados

Una respuesta HTTP 401 provoca la limpieza
de la sesión local correspondiente.

Una respuesta HTTP 403 muestra un estado
de acceso restringido.

El backend continúa siendo responsable
de la autorización definitiva.

## 11. Consideraciones temporales

Los indicadores de ventas utilizan el intervalo
de fechas solicitado.

Los indicadores de caja, inventario y sincronización
representan el estado consultado y no necesariamente
un histórico del periodo seleccionado.

No se presentan cifras ficticias cuando un usuario
carece de permisos sobre algún indicador.

## 12. Pruebas realizadas

Se verificaron funcionalmente:

- Carga inicial
- Indicadores de ventas
- Indicadores de caja
- Indicadores de inventario
- Filtros rápidos
- Fechas personalizadas
- Validación de periodos
- Actualización manual
- Persistencia de sesión
- Estado sin ventas
- Tabla diaria plegable
- Visualización de ventas históricas

También se validaron TypeScript, Vite y ESLint.

## 13. Evidencia de resultados

Periodo histórico:

28/09/2026 al 29/09/2026.

Resultados observados:

- Ventas brutas: 9087.52
- Monto devuelto: 7951.58
- Ventas netas: 1135.94
- Operaciones: 7
- Devoluciones registradas: 7
- Ticket promedio: 1298.22
- Cajas activas: 1
- Sesiones abiertas: 1
- Existencias registradas: 1

La prueba permitió confirmar que la gráfica
representa importes distintos de cero y que
la tabla presenta los importes diarios.

Estos valores corresponden al entorno de pruebas
y no deben interpretarse como resultados productivos.

## 14. Restricciones actuales

- No existe selector visual de sucursal.
- No hay actualización automática periódica.
- Los indicadores dependen de los permisos de usuario.
- No se incorporaron operaciones de escritura.
- No se modificó el backend.
- No se activó la sincronización de E-commerce.

## 15. Recomendaciones futuras

- Incorporar selector de sucursales autorizadas.
- Agregar pruebas automatizadas de componentes.
- Implementar actualización periódica configurable.
- Extraer componentes visuales compartidos cuando
  otros módulos requieran las mismas tarjetas o tablas.
- Evaluar nuevas gráficas según las necesidades reales.

## 16. Estado del módulo

Implementación funcional terminada.

Pruebas funcionales y visuales principales aprobadas.

Fecha de validación: 9 de noviembre de 2026.
