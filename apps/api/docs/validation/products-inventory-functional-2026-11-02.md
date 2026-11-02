# POSMYCLETH — Validacion funcional

Fecha: 2026-11-02
Rama: devalex
Base local: pos_novnix
Sincronizacion Ecommerce: deshabilitada durante pruebas

## Productos / Catalogo

- Unitarias: 23/23 aprobadas.
- Nueve ejecuciones unitarias corresponden a casos duplicados.
- PostgreSQL con rollback: 11 comprobaciones aprobadas.
- Integracion HTTP: 30 comprobaciones aprobadas.
- Autenticacion, permisos, aislamiento multiempresa,
  creacion, consultas, actualizacion y cambio de estado.
- Limpieza de registros sinteticos confirmada.

Resultado: bateria funcional existente aprobada.

## Inventario

- Unitarias: 19/19 aprobadas.
- PostgreSQL con rollback: 11 comprobaciones aprobadas.
- Integracion HTTP aislada: 20/20 aprobadas.
- Concurrencia avanzada: 3 escenarios aprobados.
- Idempotencia, ajustes positivos y negativos,
  existencias, movimientos, kardex y auditoria.
- Control de existencias negativas verificado.
- Limpieza de registros sinteticos confirmada.

Resultado: bateria funcional existente aprobada.

## Integridad Ecommerce

- Eventos historicos: 73.
- Eventos no sincronizados: 0.
- Auditorias historicas: 44.
- Fingerprint M13 de eventos: 5b24127c8fe145a8.
- Fingerprint M13 de auditoria: 97de5a49f9af6cf8.
- Preflight anterior y posterior aprobado.
- Sin ejecucion de sincronizacion real con Ecommerce.

## Pendientes

1. Definir si INVENTARIO.VER e INVENTARIO.AJUSTAR
   deben restringirse por sucursal asignada al usuario.
2. Atender la advertencia de deprecacion del paquete pg.
3. Validar la sincronizacion real con Ecommerce
   antes de habilitar el worker en produccion.
4. Realizar validaciones adicionales cuando cambien
   los servicios, permisos o esquemas relacionados.

## Alcance

Estas pruebas se ejecutaron sobre la base local
pos_novnix, utilizando fixtures sinteticos.

Los resultados no sustituyen pruebas de aceptacion
en un entorno productivo.
