# POSMYCLETH — Informe final de aceptación v4

- HEAD: `f9fca834cb5c6c23db4e8564ae2f9e816af3e49a`
- Base: pos_novnix / pos
- Regresión v3: PASS ({"PASS":107,"FAIL":0,"SKIP":5})
- v4: PASS 7, FAIL 0, SKIP 0
- **Resultado funcional: ACEPTACION_FUNCIONAL_ENTORNO_PRUEBAS**
- **Autorización para producción: NO determinada por esta suite**

| Escenario | Estado | Evidencia |
|---|---|---|
| Regresión integral v3 | PASS | `01-Regresion-integral-v3.log`; {"counts":{"PASS":107,"FAIL":0,"SKIP":5},"dirty_tables":[],"process":"exit=0,signal=none,elapsed_ms=138258"} |
| Multiempresa/multisucursal HTTP | PASS | `02-Multiempresa-multisucursal-HTTP.log`; exit=0,signal=none,elapsed_ms=3080; 47 tablas con huellas restauradas |
| Multiempresa HTTP: aislamiento positivo/negativo | PASS | 2 empresas, 3 sucursales, usuarios con alcance parcial comprobados |
| Multisucursal HTTP: acceso parcial en JSON/CSV | PASS | Rutas JSON/CSV y límites sucursales bajo mismo fixture |
| Flujo E2E: compra-recepción-transferencia-venta-devolución | PASS | `05-Flujo-E2E-compra-recepci-n-transferencia-venta-devoluci-n.log`; exit=0,signal=none,elapsed_ms=2778; 47 tablas con huellas restauradas |
| Contrato Ecommerce con mock HTTP independiente | PASS | `06-Contrato-Ecommerce-con-mock-HTTP-independiente.log`; exit=0,signal=none,elapsed_ms=1961; 47 tablas con huellas restauradas |
| Carga HTTP 500 solicitudes y SLO provisional | PASS | `07-Carga-HTTP-500-solicitudes-y-SLO-provisional.log`; exit=0,signal=none,elapsed_ms=7109; 47 tablas con huellas restauradas |

## Limitaciones (no se ocultan)
- Ecommerce: se verifica un mock HTTP local, NO una integración con servicio real externo/staging.
- Carga: umbrales SLO provisionales y base pequeña; NO establece SLA de producción.
- Fixture E2E comprueba un flujo secuencial real; no certifica atomicidad de múltiples transacciones como una sola operación.
- Las secuencias PostgreSQL pueden avanzar con los fixtures aunque las tablas queden restauradas.
- Revisar cambios locales de los parches v2/v3 antes de hacer commit; este script no realiza commits ni migraciones.

## Decisión de aceptación

Apto para continuar hacia preproducción con las limitaciones enumeradas; NO equivale a aprobación de despliegue público.

## Preservación de datos

La suite verifica huellas de 47 tablas antes y después de cada escenario. Si la limpieza falla, conserva marcadores de fixtures en logs para revisión manual. No elimina datos ajenos automáticamente.
