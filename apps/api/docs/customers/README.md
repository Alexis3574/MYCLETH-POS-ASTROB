# POSMYCLETH — Clientes (`customers`)

## Alcance y estado

Implementación preparada utilizando las entidades existentes `pos.cliente` y `pos.cliente_direccion` del esquema Prisma de referencia. Sin migraciones nuevas. Se integra a ventas y cotizaciones por las relaciones Prisma ya existentes, **sin modificar el flujo de ventas**. Es código preparado para incorporación: **no probado ni validado en el backend real**.

### API

Base: `/api/v1/customers`. Todas las rutas requieren JWT, empresas limitadas a `req.auth.empresaId`.

| Método | Ruta | Permiso | Uso |
|---|---|---|---|
| GET | `/` | `CLIENTES.VER` | Lista paginada, `page`, `pageSize`, `q` y `activo=true/false` |
| POST | `/` | `CLIENTES.CREAR` | Crear cliente |
| GET | `/:customerId` | `CLIENTES.VER` | Consultar cliente y sus direcciones |
| PATCH | `/:customerId` | `CLIENTES.EDITAR` | Actualizar o activar/desactivar cliente |
| GET | `/:customerId/addresses` | `CLIENTES.VER` | Consultar direcciones |
| POST | `/:customerId/addresses` | `CLIENTES.EDITAR` | Crear dirección |
| PATCH | `/:customerId/addresses/:addressId` | `CLIENTES.EDITAR` | Editar dirección |
| DELETE | `/:customerId/addresses/:addressId` | `CLIENTES.EDITAR` | Eliminar dirección secundaria o la única |

No hay endpoint de eliminación física de clientes: conserva las relaciones con ventas, pedidos y cotizaciones. El permiso de edición permite desactivarlos vía `PATCH` con `{"activo": false}`.

### Ejemplos

Crear:
```json
{
  "codigo": "CLI-0001",
  "nombre": "Cliente de ejemplo",
  "rfc": "XAXX010101000",
  "email": "cliente@ejemplo.mx",
  "telefono": "5512345678",
  "limite_credito": "1500.00",
  "dias_credito": 30
}
```

Crear dirección:
```json
{
  "tipo": "FISCAL",
  "calle": "Av. Principal",
  "numero_exterior": "123",
  "municipio": "Ciudad de México",
  "estado": "Ciudad de México",
  "codigo_postal": "06000",
  "pais": "México",
  "es_principal": true
}
```

Actualizar datos: `PATCH /api/v1/customers/1` con `{"nombre":"Razón actualizada", "activo":true}`.

### Contratos y reglas

- Contrato HTTP: `{"ok": true, "data": ...}` en éxito; `{"ok": false, "code": "...", "message": "..."}` al rechazar; validación Zod devuelve un arreglo `errors`.
- Se verifica empresa de los clientes y se filtran direcciones por `cliente_id` después de confirmar empresa.
- El código debe ser único **por empresa** usando el índice preexistente `uq_cliente_empresa_codigo`. Se maneja el conflicto `P2002` ante concurrencia.
- `rfc` y correo se normalizan a mayúsculas y minúsculas, respectivamente. El RFC, correo y teléfono son opcionales.
- `limite_credito` acepta importes sin negativos y con hasta dos decimales, como cadena para preservar `DECIMAL(14,2)`. `dias_credito` solo admite enteros no negativos. La autorización de ventas a crédito todavía depende de reglas de Ventas y no se ha implementado aquí.
- Direcciones principales se administran dentro de transacciones con bloqueo de la fila del cliente. Si ya hay direcciones, no se puede eliminar la principal sin designar otra. Se agrega registro de auditoría en cada cambio.
- La tabla de direcciones provista no dispone de `activo`; se admite eliminación física **solo** para direcciones, no para clientes.
- El valor `pais` se establece en `México` al crear sin especificarlo, evitando depender del valor que aparece con codificación defectuosa en el snapshot de Prisma.
- El campo `tipo` acepta hasta 20 caracteres; se deben reconciliar los valores permitidos con los CHECK SQL vigentes antes de poner en producción.

### Instalación y permisos

El instalador copia exclusivamente `src/modules/customers`, el README y `scripts/create-customer-permissions.ts`; monta `customerRouter` en `src/app.ts`. No crea permisos automáticamente. Los permisos (`CLIENTES.VER`, `CLIENTES.CREAR`, `CLIENTES.EDITAR`) se registran únicamente cuando se autorice correr `npx tsx scripts/create-customer-permissions.ts` en la BD apropiada, y luego se asignan a los roles autorizados.

### Validación pendiente

**NO EJECUTADA:** compilación TypeScript, build, `prisma validate`, arranque, API HTTP, autenticación y permisos, CRUD, paginación, duplicados, límites de RFC y crédito, persistencia, transacciones, aislamiento entre empresas, concurrencia, compatibilidad de CHECK, regresión de ventas y limpieza de fixtures. Ejecutar en fase de validación con BD aislada, nunca asumir éxito de lo no ejecutado.

**Ficha de transferencia (borrador):** POSMYCLETH-BE-CUSTOMERS-20261015; implementación propuesta en módulo `customers`; alcance y endpoints arriba; referencias `cliente`, `cliente_direccion`, `venta`, `cotizacion`, `orden_venta`, `pedido_cliente`; pruebas no ejecutadas; referencia Git pendiente al integrar en rama `devalex`.
