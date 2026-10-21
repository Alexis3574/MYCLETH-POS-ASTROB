# POSMYCLETH — Módulo 8: Organización (implementación preparada, validación pendiente)

Base: `1dfc05b` de `devalex` · Stack: Express 5, Zod 4, Prisma 7.10, PostgreSQL 17, Node 24 local.

## Principios

- **Sin migración inicial:** tablas `pos.empresa`, `pos.sucursal`, `pos.almacen`, `pos.usuario_sucursal` preexistentes.
- **Sin crear permisos:** reutiliza `CONFIGURACION.GESTIONAR`, asociado a `ADMIN` según diagnóstico real del 21 de octubre de 2026.
- **Solo empresa autenticada:** nunca se acepta `empresa_id` desde el cliente; JWT `req.auth.empresaId` y filtro en consultas.
- **Sin borrados físicos:** evita cascadas existentes que podrían eliminar stock y documentos.
- **Empresa propia:** consulta y edición de campos permitidos; su desactivación no se expone para evitar bloquear al tenant.
- **Sucursales:** alta, consulta paginada, modificación, activación/desactivación controladas.
- **Almacenes:** alta, consulta paginada, modificación, activación/desactivación controladas; sucursal inmutable una vez creado.
- **Usuarios de sucursal:** listado, asignación, predeterminada y revocación; mismo tenant requerido.
- Auditoría en `pos.auditoria`, con actor verificado. No almacena contraseñas en auditoría.
- Sin tocar servicios/rutas de los módulos 1–7. Solo se registra el router en `src/app.ts`.

## Rutas

| Verbo | Ruta bajo `/api/v1/organization` | Permiso |
|---|---|---|
| GET | `/company` | `CONFIGURACION.GESTIONAR` |
| PATCH | `/company` | `CONFIGURACION.GESTIONAR` |
| GET / POST | `/branches` | `CONFIGURACION.GESTIONAR` |
| GET / PATCH | `/branches/:branchId` | `CONFIGURACION.GESTIONAR` |
| GET / POST | `/branches/:branchId/users` | `CONFIGURACION.GESTIONAR` |
| DELETE | `/branches/:branchId/users/:userId` | `CONFIGURACION.GESTIONAR` |
| GET / POST | `/warehouses` | `CONFIGURACION.GESTIONAR` |
| GET / PATCH | `/warehouses/:warehouseId` | `CONFIGURACION.GESTIONAR` |

Todos los endpoints requieren JWT real y pertenencia al tenant.

## Instalación de forma controlada

Desde `apps/api` en Git Bash:

```bash
node "/c/Users/taiga/Documentos/pos-organization-module/tools/install-organization.mjs" --check
node "/c/Users/taiga/Documentos/pos-organization-module/tools/install-organization.mjs" --install
```

El instalador verifica la rama, que `1dfc05b` sea ancestro del `HEAD`, que existan los cuatro modelos y que no exista todavía un módulo local. Crea respaldo de `src/app.ts` fuera del repositorio. No modifica `schema.prisma`, no migra PostgreSQL y no hace commit.

## Secuencia de pruebas — NO EJECUTAR SIN REVISAR

1. `npm run typecheck`.
2. `npx tsx scripts/organization/check-organization-setup.ts` (solo lectura).
3. `npx tsx --test tests/organization/organization-unit.test.ts`.
4. Con servidor/worker de Ecommerce detenidos, `POS_ALLOW_TEST_DB=SI node tests/organization/organization-postgres.rollback.mjs` (fixture sintético en transacción y rollback).
5. Iniciar API con `INVENTORY_SYNC_ENABLED=false npm run dev` en primera terminal. En segunda: `POS_HTTP_URL=http://127.0.0.1:3000 node tests/organization/organization-http.synthetic.mjs` (credenciales y JWT sintéticos, limpieza transaccional).
6. Regresión de los siete módulos; comprobar Git diffs y preparar commit **solo después de aprobación del usuario**.

Si un script de integración reporta `[ERROR LIMPIEZA]`, **NO repetirlo**; inspeccionar primero el fixture identificado y resolver conservando integridad.

## Restricciones conocidas y validación obligatoria

- Los triggers actuales son de actualización automática de timestamps; **no** hay RLS en las tablas organizacionales. La API aplica seguridad por tenant, pero el esquema por sí solo no impide una asignación cruzada a `usuario_sucursal` si otro consumidor escribe directamente.
- Las reglas de desactivación son preventivas y verifican stock/reservas, borradores, sesiones y asignaciones. **No constituyen aún una garantía global de concurrencia** si otras rutas existentes alteran estados sin bloquear los mismos padres; probar escenarios concurrentes y considerar restricciones adicionales en una fase futura, con autorización explícita.
- El rol `CONFIGURACION.GESTIONAR` permite administrar **solo su propia empresa**, no otras. La administración global queda fuera de alcance.
- **No está demostrado** hasta ejecutar `npm run typecheck` y los tests sobre la máquina del usuario que el módulo esté funcional; este paquete es candidato para instalación y validación, no código aprobado.
