# POSMYCLETH — Proveedores (`suppliers`)

**Ficha técnica:** POSMYCLETH-BE-SUPPLIERS-20261015 · Rama objetivo `devalex` · Estado: código preparado, no validado en backend real.

## Propósito y dependencias

Implementa gestión empresarial de proveedores y direcciones reutilizando los modelos existentes `pos.proveedor` y `pos.proveedor_direccion` (Prisma 7/PostgreSQL). Reutiliza `req.auth.empresaId`, `req.auth.userId`, `requireAuth`, `requirePermission` y `prisma`. No añade migraciones ni toca flujos de compras o pagos. Las compras existentes mantienen su FK a proveedor y **no se eliminan físicamente proveedores**.

## Rutas HTTP

Prefijo: `/api/v1/suppliers`. Todas requieren JWT. En listados, altas, lecturas y mutaciones, el alcance de empresa proviene **exclusivamente** del token.

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/` | `PROVEEDORES.VER` | Lista paginada. `page`, `pageSize` (1-100), `q`, `activo=true/false` |
| POST | `/` | `PROVEEDORES.CREAR` | Alta de proveedor |
| GET | `/:supplierId` | `PROVEEDORES.VER` | Detalle con direcciones |
| PATCH | `/:supplierId` | `PROVEEDORES.EDITAR` | Actualización y activación/desactivación |
| GET | `/:supplierId/addresses` | `PROVEEDORES.VER` | Direcciones del proveedor |
| POST | `/:supplierId/addresses` | `PROVEEDORES.EDITAR` | Alta de dirección |
| PATCH | `/:supplierId/addresses/:addressId` | `PROVEEDORES.EDITAR` | Edición de dirección |
| DELETE | `/:supplierId/addresses/:addressId` | `PROVEEDORES.EDITAR` | Elimina dirección, con protección para la principal |

No existe endpoint para eliminar físicamente proveedores; desactivar: `PATCH /:supplierId` con `{ "activo": false }`.

## Contrato

- Respuestas correctas: `{ "ok": true, "data": ... }`; errores esperados: `{ "ok": false, "code": "...", "message": "..." }`. Errores Zod devuelven también `errors`.
- IDs `BigInt` en formato de cadena. Valores Prisma Decimal como cadenas si aparecen en datos regresados.
- `400`: entrada/identificador inválidos; `404`: proveedor/dirección ajenos o inexistentes; `409`: código duplicado por empresa, conflicto de dirección o relación protegida. `401` y `403` corresponden a los middleware compartidos.
- Operaciones de escritura y auditoría son atómicas en transacciones Prisma; los cambios sobre direcciones principales serializan bloqueando la fila del proveedor con `FOR UPDATE`.

## Esquemas y ejemplos

Crear proveedor: `POST /api/v1/suppliers`

```json
{
  "codigo": "PROV-0001",
  "razon_social": "Comercializadora Ejemplo, S.A. de C.V.",
  "nombre_comercial": "Ejemplo",
  "rfc": "XAXX010101000",
  "email": "compras@ejemplo.mx",
  "telefono": "5512345678",
  "contacto": "Departamento comercial",
  "dias_credito": 30,
  "activo": true
}
```

Los campos `codigo` y `razon_social` son obligatorios. `nombre_comercial`, `rfc`, `email`, `telefono`, `contacto` son opcionales y admiten `null`. `dias_credito` es entero entre 0 y 3650. RFC se normaliza a mayúsculas y correo a minúsculas. La validación de RFC es **sintáctica**, no comprueba existencia fiscal ante el SAT.

Crear dirección: `POST /api/v1/suppliers/1/addresses`

```json
{
  "tipo": "FISCAL",
  "calle": "Av. Proveedores",
  "numero_exterior": "45",
  "colonia": "Centro",
  "municipio": "Ciudad de México",
  "estado": "Ciudad de México",
  "codigo_postal": "06000",
  "pais": "México",
  "es_principal": true
}
```

`tipo` tiene 20 caracteres como máximo; el conjunto permitido por el CHECK SQL del esquema físico aún **debe verificarse** antes de considerar el módulo validado. La primera dirección debe ser principal. Cambiar la dirección principal actual exige designar otra; eliminar la principal se impide si existen otras direcciones. El valor `pais` se escribe explícitamente como `México` al crear si no se proporcionó.

## Reglas y límites de implementación

- Aislamiento por empresa mediante `empresa_id` de JWT; el cuerpo HTTP no admite `empresa_id` ni cambio de empresa.
- Unicidad fuerte de `codigo` por empresa por índice ya existente `uq_proveedor_empresa_codigo`, además de validación previa; también se captura el código Prisma `P2002`. El esquema físico **no** garantiza RFC único, por lo que no se declara deduplicación por RFC.
- `proveedor` se desactiva, no se elimina, para preservar compras históricas.
- Las direcciones se filtran por `proveedor_id`, después de comprobar la pertenencia empresarial del padre.
- Auditoría en `pos.auditoria` de insert/update/delete, sin guardar valores de contacto completos en el registro de cambios.
- **Condiciones de pago:** el esquema recibido solo dispone de `dias_credito`. No existe campo `condiciones_pago`, ni política de crédito parametrizada en Proveedores; extender este punto requeriría una migración aditiva diseñada sobre el esquema real, por lo que no se simula ni se agrega en esta entrega.
- **Compras:** la relación Prisma `compra.proveedor_id` queda disponible para integración futura. No se modifican lógica de compras ni reglas de comprobación de proveedor activo en ese flujo.
- No se agregan nuevas restricciones SQL, ni índices ni migraciones. Verificar restricciones CHECK efectivas al validar.

## Instalación

Desde `POSMYCLETH/apps/api`:

```bash
node "C:/Users/taiga/Documentos/POSMYCLETH/posmycleth-proveedores/apply-suppliers.mjs" .
```

El instalador comprueba antes de escribir si los destinos existen; detiene la instalación si ya hay módulo u otros recursos. Copia `src/modules/suppliers`, `docs/suppliers/README.md`, `scripts/create-supplier-permissions.ts` y registra router en `src/app.ts` antes de `errorMiddleware`. No hace cambios sobre base de datos, roles o Git.

**No ejecutar todavía**, hasta llegar a la fase de validación y elegir base segura: `npx tsx scripts/create-supplier-permissions.ts` (escritura explícita en la base configurada). Posteriormente asignar permisos a roles autorizados.

## Lista de pruebas posteriores — NO EJECUTADAS

1. `npm run typecheck` y `npm run build`, `npx prisma validate`.
2. Inicio de API y conexión PostgreSQL, revisión de endpoints montados.
3. Pruebas HTTP positivas y negativas (400/401/403/404/409, comportamiento 500).
4. CRUD proveedor, filtrado, paginado, estado, duplicados, dirección principal.
5. Separación por empresa, credenciales inválidas, permisos y rechazo de `empresa_id` en body.
6. Concurrencia: dos altas con mismo código y selección simultánea de dirección principal.
7. Persistencia, auditoría, consistencia transaccional, rollback ante error.
8. Validar condiciones CHECK SQL de direcciones y campos, regresión con `compra.proveedor_id`.
9. Confirmar no alteración de otros módulos, comparar Git diff, limpieza de datos de prueba.

No se ha ejecutado ninguna prueba funcional ni consulta a la base real; no afirmar que están aprobadas.

## Ficha para Informe Técnico (borrador)

**Identificador:** POSMYCLETH-BE-SUPPLIERS-20261015. **Objetivo:** administración de proveedores, contactos fiscales/comerciales, direcciones y crédito en días, manteniendo integración referencial con Compras. **Componentes:** router, Zod, service, errores, utilidades, script de permisos y documentación. **Integraciones:** `Prisma.proveedor`, `proveedor_direccion`, `auditoria`, roles/JWT y FK desde `compra`. **Evidencia:** código del paquete y eventual diff de instalación. **Pruebas:** pendientes, NO EJECUTADAS. **Pendientes:** revisión de CHECK SQL, condiciones de pago detalladas, typecheck, arranque y pruebas reales. **Git:** commit no proporcionado, rama objetivo `devalex`. **Apartados:** análisis, arquitectura, implementación, seguridad, pruebas y resultados.
