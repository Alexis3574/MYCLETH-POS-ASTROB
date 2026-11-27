# Usuarios, roles y permisos — avance frontend

Fecha: 23 de noviembre de 2026, America/Mexico_City.

Estado: **IMPLEMENTADO Y VALIDADO CON IDENTIDADES FICTICIAS. VALIDACIÓN REAL Y CIERRE PENDIENTES.**

## Funcionalidades

Rutas `/users/:userId?`, `/roles` y `/permissions`, visibles con `USUARIOS.VER`. `USUARIOS.GESTIONAR` habilita alta/edición de usuarios, cambio de contraseña, alta/edición/eliminación de roles y asignación/retiro de roles y permisos. El catálogo de permisos es de consulta: no se inventó un endpoint para crear códigos.

Usuarios muestra datos públicos, empresa, estado activo/bloqueado y último acceso, con lista paginada y detalle. Los formularios gestionan usuarios de la empresa actual; empresa no es un campo libre. La interfaz impide desactivar la propia sesión o modificar sus roles, y no ofrece edición de un rol que participa en los roles de la sesión actual. Estas precauciones de interfaz no sustituyen controles del servidor.

Roles permite revisar usuarios/permisos asignados, estado y descripción, buscar permisos y confirmar cada asignación/retiro por separado. El catálogo de roles es compartido. Eliminar requiere confirmación explícita; no se presenta como desactivación reversible, y el backend rechaza roles en uso. La eliminación se probó con el oráculo automatizado; no se eliminó un rol real ni se ejecutó esa acción desde el navegador durante esta revisión.

Código en `apps/web/src/features/users/` (tipos, validación, servicio, formulario y vista), `features/roles/RolesWorkspace.tsx`, `features/permissions/PermissionCatalog.tsx` y páginas correspondientes en `src/pages/`. Se reutilizan las protecciones de mutaciones documentadas en [Cotizaciones y pedidos](cotizaciones-pedidos-avance.md).

## Contratos

| Función | API bajo `/api/v1` |
| --- | --- |
| Usuarios | GET/POST `/users`, GET/PATCH `/users/:id` |
| Contraseña | PATCH `/users/:id/password` |
| Roles | GET/POST `/roles`, GET/PATCH/DELETE `/roles/:id` |
| Roles de usuario | GET `/users/:userId/roles`, POST/DELETE `/users/:userId/roles/:roleId` |
| Permisos | GET `/permissions` |
| Permisos de rol | GET `/roles/:roleId/permissions`, POST/DELETE `/roles/:roleId/permissions/:permissionId` |

Usuarios responde con `data:[]` y `pagination:{page,limit,total,totalPages}`. Roles y permisos responden con arrays sin paginación; la búsqueda del catálogo es local. Los roles de usuario son un array de roles; los permisos de rol son `{rol,permisos}`. Asignar/retirar devuelve las identidades de ambos extremos, que se verifican antes de confirmar. Eliminar rol devuelve `{id}`. **Cambiar contraseña devuelve `{ok:true,message}` sin `data`**; la vista consume ese contrato y no exige un usuario ficticio en la respuesta.

Las contraseñas deben coincidir, tener al menos ocho caracteres y no superar 72 bytes UTF-8, respetando el límite del backend. Los campos de contraseña se vacían al preparar la confirmación; el secreto se mantiene únicamente en la solicitud pendiente en memoria hasta enviarla. No se incluye en la confirmación visual, descriptor de `sessionStorage`, resultado, logs ni resúmenes del simulador. El correo se normaliza a minúsculas como en el servicio real.

## Alcance de empresa: pendiente de revisión backend

La inspección comprobó que `userRepository.findMany/count/findById` no incorpora filtro por empresa en estas rutas administrativas. Roles también es un catálogo global. La lista muestra la empresa de cada usuario y los formularios restringen la gestión a la empresa actual, pero esto **no corrige ni demuestra aislamiento multempresa de la API**. Debe revisarse la política administrativa y su implementación backend antes de habilitar/validar gestión real entre empresas. No se cambió el servidor por iniciativa del frontend ni se consultaron datos reales de otros usuarios.

## Validaciones

La batería conjunta pasó con **116 pruebas, 0 fallidas**, build y ESLint correctos. Las nuevas pruebas comprueban DTO, IDs, normalización, límites UTF-8, duplicados, asignaciones y retiro, prohibición de borrar roles en uso, permisos de solo consulta y respuesta HTTP de contraseña sin `data`. El simulador no guarda contraseñas y utiliza solo nombres/correos ficticios.

En navegador:

1. Crear `operador-ui-001` con correo de dominio `.test` y empresa ficticia 1; consultar su detalle y editar nombre a Operador UI actualizado.
2. Probar el cambio de credencial ficticia. Tras ajustar y reiniciar el simulador con el contrato real sin `data`, repetir el cambio desde el formulario: éxito y cero protecciones pendientes.
3. Crear CAJERO-UI, asignar COTIZACIONES.VER, asignar el rol al usuario y comprobarlo. Retirar el rol y el permiso. Editar el nombre del rol a Cajero UI actualizado. Usuarios/roles/credenciales reales no se modificaron.
4. Seleccionar ADMIN-QA, rol de la sesión ficticia: no aparece Editar rol. En la identidad de solo consulta no aparecen Crear usuario ni Crear rol.
5. Consultar el catálogo de permisos y filtrar COTIZACIONES: se muestran sus códigos de consulta y creación.

Los ejemplos se restituyeron por HTTP exclusivamente al simulador después de su reinicio final, con rol sin asignaciones y el usuario ficticio disponible para revisión. La captura de la asignación anterior (`usuario-roles-modulos.jpg`) representa el paso probado antes de retirarla, no su estado final. La comprobación final de consola no mostró errores ni advertencias. La emulación móvil no aplicó el tamaño solicitado, por lo que su revisión queda pendiente.

No se instalaron dependencias ni se modificaron backend, migraciones, AGENTS.md o contexto maestro. No hubo staging, commit, push o PR. Cualquier gestión real de usuarios, credenciales o permisos requiere aprobación específica posterior, con destinatarios y efectos concretos; en esta etapa solo se usaron identidades de prueba del simulador.
