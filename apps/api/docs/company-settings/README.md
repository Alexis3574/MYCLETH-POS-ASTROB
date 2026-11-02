# M15 — Configuración de la Empresa

## Estado

Versión funcional de gestión de preferencias empresariales.

Backend: POSMYCLETH.
Tecnologías: TypeScript, Express, Prisma y PostgreSQL.
Base de datos de pruebas: pos_novnix.

## Persistencia

Reutiliza la tabla existente `pos.configuracion_empresa`.

No requiere migración Prisma adicional.

La restricción `(empresa_id, clave)` evita duplicados
dentro de una misma empresa.

## API REST

- GET /api/v1/company-settings
- GET /api/v1/company-settings/:clave
- PUT /api/v1/company-settings/:clave

Todos los endpoints requieren:

- Autenticación JWT.
- Permiso CONFIGURACION.GESTIONAR.
- Empresa activa y autorizada.

El identificador de empresa se obtiene del contexto
autenticado y no del cuerpo de la petición.

## Categorías

### ventas
- confirmar_antes_de_cobrar
- mostrar_resumen_impuestos
- solicitar_cliente_en_venta

### inventario
- mostrar_alertas_stock_bajo
- umbral_stock_bajo

### comprobantes
- mostrar_rfc
- mostrar_direccion
- leyenda_ticket

### interfaz
- pagina_inicial
- elementos_por_pagina
- mostrar_sugerencias

## Contrato de actualización

PUT reemplaza completamente el valor de una categoría.

Ejemplo:

PUT /api/v1/company-settings/ventas

{
  "valor": {
    "confirmar_antes_de_cobrar": true,
    "mostrar_resumen_impuestos": true,
    "solicitar_cliente_en_venta": false
  }
}

Las claves, tipos y límites se validan mediante Zod.

Las categorías sin registro utilizan valores
predeterminados definidos por el módulo.

## Integración con M14

Las operaciones INSERT y UPDATE generan auditoría
dentro de la transacción Prisma de actualización.

La auditoría registra la clave y la operación,
sin almacenar el JSON completo de configuración.

Los eventos de configuracion_empresa son
de alcance empresarial, no de sucursal.

Se ajustó la serialización del M14 para permitir
sucursal_id nulo.

## Pruebas funcionales

- TypeScript sin errores.
- Siete pruebas unitarias aprobadas.
- Nueve pruebas de integración HTTP aprobadas.
- Siete pruebas finales de actualización aprobadas.
- JWT válido e inválido.
- Permisos y accesos denegados.
- Validación de datos incorrectos.
- Persistencia real de INSERT y UPDATE.
- Auditoría accesible por HTTP.
- Restauración del valor original.
- Regresión M14 aprobada.

Durante las pruebas de implementación se pasó
de 44 a 48 registros históricos de auditoría.
Los cuatro eventos nuevos corresponden a pruebas
funcionales de M15.

## Alcance y pendientes

Las configuraciones se almacenan y consultan,
pero sus efectos sobre procesos de negocio
requieren integración explícita con cada módulo.

Pendientes:
- Pruebas reales entre dos empresas autorizadas.
- Integración de preferencias en ventas e inventario.
- Integración con generación de comprobantes.
- Consumo de preferencias en el frontend.
- Validación de comportamiento con registros JSON
  heredados que no cumplan el esquema actual.

No se modifican datos generales de la empresa,
sucursales ni almacenes; estas operaciones
permanecen en el módulo Organización.

## Cierre

M15 cerrado como versión funcional de API de
configuración empresarial, con pendientes
documentados para futuras integraciones.
