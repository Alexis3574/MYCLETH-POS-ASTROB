# Módulo Frontend: Layout y Navegación Administrativa

## 1. Descripción general

Este módulo constituye la estructura principal de navegación del
sistema POSMYCLETH, un punto de venta empresarial.

Proporciona una interfaz administrativa responsiva, navegación
entre rutas, control de acceso basado en autenticación, filtrado
visual mediante permisos y persistencia de sesión.

## 2. Objetivo

Proporcionar una estructura reutilizable para integrar los
módulos operativos y administrativos del POS sin duplicar
interfaces, lógica de navegación ni controles de autenticación.

## 3. Tecnologías utilizadas

- React 19.
- TypeScript.
- Vite 8.
- React Router 8.
- CSS modular por layout y página.
- Fetch API para comunicación HTTP.
- sessionStorage para persistencia temporal de autenticación.
- localStorage para preferencias visuales del sidebar.

## 4. Arquitectura del módulo

### Archivos principales

- apps/web/src/App.tsx
  Punto de entrada del sistema de rutas.

- apps/web/src/app/router/AppRouter.tsx
  Definición de rutas, redirecciones y validación de sesión.

- apps/web/src/app/navigation/navigation.config.ts
  Configuración centralizada de secciones y opciones del menú.

- apps/web/src/layouts/AuthLayout.tsx
  Estructura visual para autenticación.

- apps/web/src/layouts/DashboardLayout.tsx
  Estructura administrativa compartida.

- apps/web/src/layouts/DashboardLayout.css
  Estilos del sidebar, encabezado y diseño responsivo.

- apps/web/src/features/auth/auth.session.ts
  Administración de sesión, expiración y persistencia.

- apps/web/src/features/auth/useAuthSession.ts
  Suscripción reactiva a cambios de autenticación.

- apps/web/src/features/auth/auth.service.ts
  Comunicación con los endpoints de autenticación.

- apps/web/src/services/api.ts
  Cliente HTTP reutilizable.

## 5. Flujo de autenticación

1. El usuario proporciona sus credenciales.
2. El frontend realiza la petición de inicio de sesión.
3. El backend valida las credenciales y devuelve la sesión.
4. El frontend conserva el token y los datos de usuario.
5. React Router permite acceder al dashboard.
6. Al actualizar la página se restaura la sesión almacenada.
7. El frontend consulta /auth/me para validar el token restaurado.
8. Si el token es rechazado por autenticación o autorización,
   se elimina la sesión local.
9. Al cerrar sesión se elimina la sesión almacenada y se
   redirige al login.

### Consideraciones de seguridad

La sesión se conserva en sessionStorage, por lo que su
persistencia está limitada al contexto de navegación de la pestaña.

El token permanece accesible al JavaScript del frontend.
Esto requiere mantener las medidas de prevención de XSS.

No existe, en esta implementación, un mecanismo de renovación
automática del token.

Si ocurre un error de red al validar la sesión restaurada,
la sesión local puede conservarse temporalmente, pero las
operaciones protegidas siguen dependiendo del backend.

La autorización definitiva siempre corresponde a la API.

## 6. Rutas implementadas

| Ruta | Descripción |
| --- | --- |
| / | Redirección según la sesión |
| /login | Inicio de sesión |
| /dashboard | Panel administrativo autenticado |
| * | Redirección temporal para rutas inexistentes |

Las pantallas operativas adicionales se incorporarán
gradualmente conforme se desarrollen sus módulos.

## 7. Navegación administrativa

El menú está organizado mediante una configuración centralizada.

Actualmente contempla las siguientes secciones:

- General.
- Operaciones.
- Administración.

Las opciones visibles se filtran con los códigos de permisos
proporcionados por el backend.

Ejemplos de permisos integrados:

- VENTAS.VER
- PRODUCTOS.VER
- INVENTARIO.VER
- CLIENTES.VER
- COMPRAS.VER
- USUARIOS.VER

Los módulos que todavía no disponen de pantalla implementada
no tienen navegación activa.

Ocultar una opción no sustituye la validación de permisos
que debe efectuar el backend.

## 8. Sidebar responsivo

El sidebar permite:

- Navegación desde escritorio.
- Menú móvil desplegable.
- Contracción y expansión en escritorio.
- Visualización de iconos cuando está contraído.
- Persistencia local de la preferencia visual.
- Identificación de la opción de navegación activa.
- Consulta del nombre de la empresa autenticada.

El diseño reutiliza la identidad visual de POSMYCLETH.

## 9. Componentes reutilizables

DashboardLayout encapsula:

- Sidebar.
- Encabezado administrativo.
- Información de usuario.
- Botón de cierre de sesión.
- Contenedor principal de contenido.

AuthLayout encapsula la presentación visual del acceso.

La configuración del menú se mantiene separada de su
representación visual para facilitar su ampliación.

## 10. Validación realizada

Se comprobaron funcionalmente:

- Acceso inicial al login.
- Protección de la ruta del dashboard.
- Inicio de sesión.
- Redirección con sesión activa.
- Cierre de sesión.
- Redirección ante rutas inexistentes.
- Navegación del sidebar.
- Contracción y expansión del sidebar.
- Persistencia de preferencia visual.
- Conservación de sesión al actualizar la página.
- Comportamiento responsivo.

También se realizaron comprobaciones mediante:

npm run build
npm run lint

Las verificaciones funcionales fueron confirmadas durante
el desarrollo del módulo.

## 11. Restricciones actuales

- El Dashboard todavía contiene indicadores demostrativos.
- Los módulos operativos aún no disponen de todas sus pantallas.
- El frontend no implementa renovación automática del JWT.
- No se ha implementado cierre remoto o revocación explícita
  del token desde esta interfaz.
- La integración operativa con E-commerce no forma parte
  de este módulo.

## 12. Recomendaciones futuras

- Incorporar componentes UI reutilizables.
- Agregar rutas protegidas según permisos por módulo.
- Centralizar el tratamiento de errores HTTP 401 y 403.
- Considerar autenticación mediante cookies HttpOnly
  con soporte del backend.
- Implementar el Dashboard con indicadores reales de la API.
- Añadir pruebas automatizadas de navegación y autenticación.
- Mejorar progresivamente la accesibilidad del menú móvil.

## 13. Estado

Implementación funcional validada.

Módulo cerrado para la presente etapa de desarrollo.

Fecha de validación: 9 de noviembre de 2026.
