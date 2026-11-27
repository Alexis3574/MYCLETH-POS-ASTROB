# Ventas a crédito — consulta documental

Fecha: 23 de noviembre de 2026, America/Mexico_City.

Estado: **CONSULTA IMPLEMENTADA Y VALIDADA EN SIMULADOR. CUENTAS POR COBRAR COMPLETA PENDIENTE DE BACKEND.**

La ruta `/credits`, visible con `VENTAS.VER`, consulta ventas con `condicion_pago=CREDITO`, paginación y filtro por cliente cuando este puede consultarse con `CLIENTES.VER`. Reutiliza el buscador de clientes, el detalle de Ventas, los estilos y las consultas remotas. El listado indica total de venta y el resumen muestra crédito original, devuelto y neto documental del documento seleccionado.

Archivos: `apps/web/src/features/credits/CreditsWorkspace.tsx`, `credit.logic.ts` y `src/pages/CreditsPage.tsx`. Integración en router y navegación existentes. No se creó un permiso backend ficticio para cartera.

Se inspeccionaron GET `/api/v1/sales`, GET `/sales/:id/financial-summary` y los datos de cliente. El resumen actual devuelve `credito.cuentas_por_cobrar_integrado:false`. No se encontraron rutas de cartera, aplicación de abonos o vencimientos. Por ello no se presentan estos importes como deuda pendiente o crédito disponible, no se calculan vencimientos como si fueran confirmados y no se muestran botones de cobro que simulen una operación real inexistente.

Los límites y días del cliente son configuración, no saldo. El total de una venta con pagos mixtos puede ser mayor que su crédito: en el ejemplo VTA-ORD-UI-001 el total es 232.00, con transferencia 116.00 y crédito 116.00; la vista muestra 116.00 como crédito neto documental. Se comprueba el contrato, identidad de venta, importes finitos y la relación entre original, devoluciones y neto; una cancelación deja el crédito neto en cero.

La prueba independiente de crédito verifica lectura, rechazo de un contrato incompatible, filtro de otro cliente y cancelación. La batería completa de esta etapa pasó con 116 pruebas, build y ESLint correctos; véase [Cotizaciones y pedidos](cotizaciones-pedidos-avance.md) para comandos y validación común. El oráculo POS se corrigió para devolver crédito neto después de devoluciones/cancelación y respetar `cliente_id`, conforme al contrato real, sin modificar el backend.

En navegador se consultó el crédito de la venta generada desde una orden y las condiciones C-001 (límite configurado 1000, plazo 30 días), con el aviso de integración pendiente visible. Se repitió la consulta después del reinicio final del simulador. Captura externa: `credito-documental-modulos.jpg`.

No se opera con PostgreSQL real ni se registran abonos. Para completar cuentas por cobrar se necesita definir y aprobar por separado modelo/contratos backend de cargos, aplicación de pagos, saldo pendiente, vencimientos, devoluciones/cancelaciones, caja, auditoría y repetición segura de operaciones. No se añadieron migraciones ni tablas como parte de este frontend. La integración real y la revisión móvil quedan pendientes.
