# POSMYCLETH — Productos / Catálogo, primera implementación

Código preparado a partir de `sales-module-completo.txt` y de las conversaciones exportadas. Esta entrega incorpora la administración de productos y las consultas auxiliares de categorías, unidades e impuestos. El CRUD administrativo de esos tres catálogos puede agregarse en el siguiente bloque, sobre esta misma estructura.

## Funciones incluidas

| Método | Ruta | Permiso |
|---|---|---|
| GET | `/api/v1/products` | `PRODUCTOS.VER` |
| GET | `/api/v1/products/:id` | `PRODUCTOS.VER` |
| GET | `/api/v1/products/barcode/:barcode` | `PRODUCTOS.VER` |
| POST | `/api/v1/products` | `PRODUCTOS.CREAR` |
| PATCH | `/api/v1/products/:id` | `PRODUCTOS.EDITAR` |
| PATCH | `/api/v1/products/:id/status` | `PRODUCTOS.CAMBIAR_ESTADO` |
| GET | `/api/v1/categories` | `PRODUCTOS.VER` |
| GET | `/api/v1/units` | `PRODUCTOS.VER` |
| GET | `/api/v1/taxes` | `PRODUCTOS.VER` |

Productos: `search`, `sku`, `barcode`, `categoria_id`, `tipo`, `activo`, `page`, `limit`. Búsqueda parcial por nombre/SKU/código sin distinguir mayúsculas; SKU y barcode como filtros exactos. Catálogos auxiliares: `search`, `activo`, `page`, `limit`.

Sin filtro `activo`, los listados incluyen activos e inactivos. Para la pantalla de venta debe enviarse `activo=true`. La ruta por código de barras devuelve únicamente productos activos. El detalle por ID permite consultar también inactivos para administración.

## Estructura y responsabilidades

| Archivo o carpeta | Responsabilidad |
|---|---|
| `product.routes.ts` | Rutas, JWT y permisos |
| `product.schema.ts` | Validación de parámetros, filtros y cuerpos con Zod |
| `controllers/` | Peticiones, respuestas y errores del módulo |
| `services/` | Reglas del producto y transacciones |
| `repositories/` | Consultas de productos y catálogos |
| `validators/` | Empresa de las referencias y límites de stock |
| `types/` | Tipos inferidos y cliente transaccional |
| `utils/` | Decimales exactos, paginación y serialización |

La empresa proviene exclusivamente de `req.auth.empresaId`. Categorías e impuestos se restringen a esa empresa; las unidades son globales porque así está definido el esquema actual. No se agregan tablas ni migraciones.

Los IDs se envían como cadenas y los importes se devuelven como cadenas decimales. Para evitar pérdida de precisión, envía también importes y stocks como cadenas. Se rechazan escalas mayores a las columnas: precio 2, costo 4, stock 3. No se redondean silenciosamente.

Crear un producto no genera existencias ni movimientos. `stock_minimo` y `stock_maximo` son umbrales, no la cantidad actual. No se borran productos: se cambia su estado. La desactivación conserva relaciones e historial; el módulo sales existente ya exige productos activos para vender.

## Decisiones sobre edición e integración

En esta primera versión, `sku`, `codigo_barras`, `unidad_medida_id`, `tipo` y `controla_inventario` se establecen al crear y no se modifican mediante PATCH. El worker actual resuelve el Ecommerce por código de barras y las devoluciones utilizan datos del producto; una corrección de identidad requiere un flujo coordinado. La unidad y el control de inventario también afectan cómo sales procesa cantidades y devoluciones.

Se pueden editar nombre, descripción, categoría, costo, precio, stock mínimo/máximo y asociación de impuestos. El estado se cambia en su endpoint, con permiso independiente. `impuesto_ids` omitido conserva asociaciones; `[]` elimina todas; una lista reemplaza el conjunto de manera transaccional. `categoria_id: null` elimina la categoría.

El alta admite `PRODUCTO` o `SERVICIO`. Un servicio tiene `controla_inventario=false` por defecto y rechaza `true`. Un producto tiene `true` por defecto. Conviene comprobar las restricciones SQL existentes antes de la primera alta: el snapshot contiene nombres de CHECKs, pero no sus expresiones.

Este módulo administra el catálogo del POS. Las altas, cambios de nombre/precio/estado no se publican automáticamente al Ecommerce. Se conserva el worker de movimientos de inventario existente. Para vender productos sincronizados, el código de barras debe coincidir con el Ecommerce; el módulo actual de sales sincroniza cantidades enteras. La importación y la sincronización administrativa de productos quedan para otro bloque.

## 1. Instalar en tu repositorio

Extrae el ZIP. Desde tu terminal Bash del POS:

```bash
cd ~/Documentos/POSMYCLETH/apps/api
```

Ejecuta el instalador indicando la ruta real a la carpeta extraída. Por ejemplo, si la extraes en Descargas de tu directorio personal:

```bash
node "$HOME/Downloads/pos-products-catalogo/install-products.mjs"
```

Ese ejemplo requiere que esa carpeta exista; usa la ruta de donde hayas extraído el ZIP. También puedes ejecutar desde la carpeta del paquete indicando la API:

```bash
node install-products.mjs "$HOME/Documentos/POSMYCLETH/apps/api"
```

El instalador:

- Comprueba la estructura de la API y que no exista previamente `products`.
- Copia el módulo a `src/modules/products`.
- Copia el script de permisos a `scripts/products-catalogo` y el SQL a `sql/products-catalogo`.
- Respalda `src/app.ts` en `products-backups/<fecha>/app.ts`.
- Agrega importaciones y rutas antes de `apiRoutes` y del middleware de errores, usando el formato del snapshot adjunto.
- Se detiene si encuentra rutas de catálogo ya registradas o una estructura que no puede adaptar.

No modifica `sales`, autenticación, Prisma ni `package.json`. Usa las dependencias que ya contiene tu API. Si debes montar rutas manualmente, agrega:

```typescript
import { productRouter, categoryRouter, unitRouter, taxRouter } from "./modules/products/product.routes.js";

app.use("/api/v1/products", productRouter);
app.use("/api/v1/categories", categoryRouter);
app.use("/api/v1/units", unitRouter);
app.use("/api/v1/taxes", taxRouter);
```

Colócalas antes de `app.use("/api/v1", apiRoutes)` y `app.use(errorMiddleware)`.

Comprueba:

```bash
npm run typecheck

npx prisma validate
```

Si tu cliente generado ya está actualizado, no necesitas regenerarlo por este módulo. Si falta o está desactualizado:

```bash
npx prisma generate
```

## 2. Crear y asignar permisos

Desde `apps/api`:

```bash
npx tsx scripts/products-catalogo/create-product-permissions.ts
```

El script es idempotente: crea los cuatro permisos si faltan, imprime sus IDs y no los asigna automáticamente a ningún rol. Alternativamente puedes ejecutar `sql/products-catalogo/01-product-permissions.sql` en tu administrador PostgreSQL. Basta con una de las dos opciones.

Con tu token existente:

```bash
curl -s \
  "http://localhost:3000/api/v1/auth/me" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json" \
  | python -m json.tool

curl -s \
  "http://localhost:3000/api/v1/roles" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json" \
  | python -m json.tool
```

Identifica el rol que corresponde a tu usuario y los IDs de permisos impresos. Para asignar cada permiso usa la ruta existente del backend. Establece valores reales; no supongas que el rol o los permisos tienen un ID determinado:

```bash
read -r -p "ID del rol confirmado: " PRODUCT_ROLE_ID
read -r -p "ID del permiso que se asignará: " PRODUCT_PERMISSION_ID

curl -s -X POST \
  "http://localhost:3000/api/v1/roles/${PRODUCT_ROLE_ID}/permissions/${PRODUCT_PERMISSION_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json" \
  | python -m json.tool
```

Repite la lectura del permiso y el POST para los cuatro permisos. Esta operación requiere `USUARIOS.GESTIONAR`. Si ya está asignado, la API existente devuelve 409. Si tu API devuelve 403 al consultar productos, comprueba primero estos permisos y el rol activo del usuario.

## 3. Primeras pruebas, solo consultas

Arranca la API en otra terminal si no sigue funcionando:

```bash
cd ~/Documentos/POSMYCLETH/apps/api
npm run dev
```

En la terminal que conserva `$TOKEN`, ejecuta uno por uno:

```bash
curl -s \
  "http://localhost:3000/api/v1/products?page=1&limit=20&activo=true" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json" \
  | python -m json.tool

curl -s \
  "http://localhost:3000/api/v1/categories?page=1&limit=100&activo=true" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json" \
  | python -m json.tool

curl -s \
  "http://localhost:3000/api/v1/units?page=1&limit=100&activo=true" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json" \
  | python -m json.tool

curl -s \
  "http://localhost:3000/api/v1/taxes?page=1&limit=100&activo=true" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json" \
  | python -m json.tool
```

Respuesta de lista: `{ "ok": true, "data": [...], "pagination": { "page": 1, "limit": 20, "total": 0, "total_pages": 0 } }`. Una lista vacía con 200 también es válida. Para búsqueda con espacios o símbolos usa `curl --get --data-urlencode "search=producto de prueba" ...`.

Para revisar los CHECKs originales desde tu cliente SQL:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'producto'::regclass AND contype = 'c'
ORDER BY conname;
```

## 4. Alta de prueba, después de confirmar consultas

Elige una unidad activa de la consulta anterior. El SKU debe ser nuevo y el código de barras puede ser null. Este ejemplo crea un producto de prueba que no controla inventario, sin impuestos ni categoría; no lo uses para probar stock o ventas sincronizadas.

```bash
read -r -p "ID de unidad activa: " PRODUCT_UNIT_ID
export PRODUCT_UNIT_ID

python - <<'PY' > /tmp/product-create.json
import json, os
print(json.dumps({
    "sku": "PRUEBA-CATALOGO-001",
    "codigo_barras": None,
    "nombre": "Producto de prueba de catálogo",
    "unidad_medida_id": os.environ["PRODUCT_UNIT_ID"],
    "tipo": "PRODUCTO",
    "controla_inventario": False,
    "precio_venta": "100.00",
    "costo_referencia": "60.0000",
    "stock_minimo": "0.000",
    "stock_maximo": None,
    "impuesto_ids": []
}))
PY

curl -s -X POST \
  "http://localhost:3000/api/v1/products" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  --data-binary @/tmp/product-create.json \
  | python -m json.tool
```

Debe devolver 201. Guarda el ID que realmente responda:

```bash
read -r -p "ID del producto creado: " PRODUCT_ID

curl -s \
  "http://localhost:3000/api/v1/products/${PRODUCT_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json" \
  | python -m json.tool

curl -s -X PATCH \
  "http://localhost:3000/api/v1/products/${PRODUCT_ID}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  --data '{"nombre":"Producto de prueba editado","precio_venta":"125.50"}' \
  | python -m json.tool

curl -s -X PATCH \
  "http://localhost:3000/api/v1/products/${PRODUCT_ID}/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  --data '{"activo":false}' \
  | python -m json.tool
```

El producto de prueba queda inactivo. Cambia a `true` en el último cuerpo para verificar reactivación. Para probar barcode, consulta un producto existente activo que tenga un código real; no se asigna uno ficticio al ejemplo.

## 5. Casos pendientes para cerrar el módulo en tu entorno

| Caso | Resultado esperado |
|---|---|
| Token ausente/expirado | 401 |
| Usuario sin permiso | 403 |
| ID ajeno a la empresa o inexistente | 404 `PRODUCT_NOT_FOUND` |
| Precio con tres decimales, negativo o ID fuera de BIGINT | 400 |
| `activo=false` en consulta | Solo inactivos |
| SKU duplicado al crear | 409 |
| Código de barras duplicado al crear | 409 |
| Categoría/impuesto de otra empresa | 400 |
| Impuestos repetidos | 400 |
| Máximo menor que mínimo, incluso en PATCH parcial | 400 `INVALID_STOCK_RANGE` |
| `SERVICIO` con control de inventario true | 400 |
| PATCH de SKU, barcode, tipo, unidad, empresa o control de inventario | 400 |
| PATCH vacío | 400 |
| `impuesto_ids: []` | Elimina asociaciones |
| Fallo en asociación de impuestos | Se revierte toda la operación |
| Dos ediciones simultáneas | Se serializan o se reintenta; conflicto persistente devuelve 409 |
| Buscar por barcode un producto inactivo | 404 |
| Producto activo vendido mediante sales | Regresión de ventas/cancelación/devolución en entorno de prueba |

## Verificación realizada al preparar la entrega

- Cliente Prisma generado con Prisma 7.10.0 y el esquema del adjunto.
- Typecheck del módulo nuevo en un arnés aislado con Express 5.2.1, Zod 4.6.5, Prisma Client/adapter 7.10.0 y TypeScript 6.0.3. El adjunto declara TypeScript 7.0.2; debe verificarse también con la versión instalada en tu repositorio.
- Nueve pruebas de schemas y cinco de decimales/IDs.
- Instalador probado con el `app.ts` del adjunto: respaldo, orden de rutas y rechazo de una segunda instalación.

El arnés usa firmas equivalentes de middleware y un cliente Prisma real generado; no ejecuta el backend completo, tu PostgreSQL, JWT real ni el Ecommerce. Las pruebas HTTP, concurrencia contra la BD y regresión de sales quedan pendientes. No declarar este módulo cerrado hasta completarlas.

El instalador también copia las pruebas a `tests/products-catalogo`. Desde `apps/api`, ejecútalas con las dependencias existentes:

```bash
node --import tsx --test tests/products-catalogo/product-values.test.mjs tests/products-catalogo/product-schema.test.ts
```

No se modifica tu script `test:sales:integration`.

## Referencias de las APIs utilizadas

- Transacciones de Prisma 7: https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions
- Validadores y transformaciones Zod: https://zod.dev/api
