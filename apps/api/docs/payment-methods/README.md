# POSMYCLETH — Módulo 9: Métodos de Pago (fase de consulta)

## Alcance de la primera implementación

Catálogo global, **solo lectura**, reutilizando `pos.metodo_pago`, los modelos generados de Prisma y la autenticación JWT actual. No hay migraciones ni permisos nuevos, ni se editan Ventas/Compras/Cajas/Devoluciones. Se evita otorgar escritura global a un administrador de empresa mediante `CONFIGURACION.GESTIONAR`.

**El esquema no contiene `empresa_id`.** Por tanto los métodos son compartidos entre empresas. El permiso de administrador por empresa NO autoriza cambios al catálogo global. La administración (altas, cambios, inactivación) queda pospuesta a un diseño de autorización central explícita. No se modifica `es_efectivo` ni los códigos especiales `CREDITO`/`EFECTIVO`.

## Endpoints (todos requieren un JWT válido)

- `GET /api/v1/payment-methods`: listado paginado, por defecto **solo activos**.
- `GET /api/v1/payment-methods?activo=all`: activos e inactivos, para información histórica.
- `GET /api/v1/payment-methods?activo=false`: solo inactivos.
- `GET /api/v1/payment-methods?codigo=EFECTIVO`: búsqueda exacta por código normalizado.
- `GET /api/v1/payment-methods?q=tarjeta&page=1&pageSize=25`: búsqueda por nombre o código (sin distinguir mayúsculas), máximo 100 por página.
- `GET /api/v1/payment-methods/:id`: detalle, incluso inactivo; IDs bigint como cadena.

Filtros permitidos: `page` (1–1000000), `pageSize` (1–100), `activo` (`true`, `false`, `all`), `codigo`, `q`. **Parámetros inesperados, duplicados o mal tipados se rechazan 400**, incluidos `empresa_id` e intentos de alterar `es_efectivo`.

Formato de éxito, lista:

```json
{
  "ok": true,
  "data": {
    "items": [{ "id": "1", "codigo": "EFECTIVO", "nombre": "Efectivo", "es_efectivo": true, "activo": true }],
    "total": 5, "page": 1, "pageSize": 25, "totalPages": 1
  }
}
```

Nota: los valores anteriores son ilustrativos; el total depende de la base y los filtros. Los errores se responden con `{ok:false,code,message}`: 400 validación, 401 JWT ausente/inválido, 403 cuenta inactiva/bloqueada, 404 ID inexistente, 500 error inesperado. No se implementa ninguna ruta POST, PUT, PATCH ni DELETE.

## Estructura

`src/modules/payment-methods/{controllers,repositories,services,utils}` más rutas y validadores. Solo se añade una importación y `app.use(...)` a `src/app.ts`.

## Instalación protegida

Desde `apps/api` y rama `devalex`:

```bash
node "/c/Users/taiga/Documentos/pos-payment-methods-module/tools/install-payment-methods.mjs" --check
node "/c/Users/taiga/Documentos/pos-payment-methods-module/tools/install-payment-methods.mjs" --install
```

Comprobar ruta según donde se haya extraído el ZIP. El instalador impide sobrescribir un módulo existente, requiere el commit del Módulo 8 en el historial, valida esquema global, respalda `src/app.ts` en la carpeta personal y **no realiza Git ni cambios de BD**.

## Validación recomendada

```bash
npm run typecheck
npx --no-install tsx --test tests/payment-methods/payment-method-unit.test.ts
npx --no-install tsx scripts/payment-methods/check-payment-method-setup.ts
POS_ALLOW_TEST_DB=SI node tests/payment-methods/payment-method-postgres.readonly.mjs
```

Con el backend levantado mediante `INVENTORY_SYNC_ENABLED=false npm run dev`:

```bash
POS_ALLOW_TEST_DB=SI POS_HTTP_URL=http://127.0.0.1:3000 node tests/payment-methods/payment-method-http.synthetic.mjs
```

El último test crea **dos empresas y usuarios exclusivamente sintéticos**, firma JWT compatibles con el backend usando el secreto local (sin imprimirlo), verifica endpoints y elimina las fixtures de forma transaccional. Requiere la base **local de desarrollo** `localhost:5432/pos_novnix`. Si falla la limpieza, no repetir hasta inspeccionar los identificadores impresos. Los tests unitarios y PostgreSQL de solo lectura no escriben datos.

Repetir después la regresión de módulos anteriores y revisar `git diff --check` y staging antes de solicitar commit/push.

## Fuera de alcance

- Mantenimiento global del catálogo y diseño de superadministrador.
- Migraciones, RLS y asignación de `empresa_id` a métodos existentes.
- Modificación de las reglas monetarias en Ventas, Compras o Devoluciones.
