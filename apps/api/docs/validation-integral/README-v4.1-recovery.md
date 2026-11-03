# POSMYCLETH v4.1 — Recuperación delimitada del fixture E2E

## Incidente

En la ejecución `final-v4-2026-11-02T23-41-10-864Z-431a254b`, el flujo completo devolvió `PASS` antes de la fase de limpieza. La limpieza falló en `venta_detalle.deleteMany` debido a la protección PostgreSQL que prohíbe editar los detalles de ventas `COMPLETADA`.

El fixture implicado es **`V4_E2E_2fe98f82087b`**. La transacción de limpieza fallida se revirtió íntegramente; el fixture puede permanecer en la base de pruebas.

## Archivos

- `scripts/validation/recover-v4-e2e.mjs`: inspector + ensayo reversible + recuperación atómica por marcador exacto.
- `scripts/validation/apply-v4.1.mjs`: añade la transición exclusivamente temporal de estados para limpiar detalles, y bloquea nuevas corridas si hay fixtures V4 previos.

## Secuencia obligatoria

1. Detener realmente POS y workers que usen `pos_novnix`.
2. Instalar ZIP mediante `unzip -n`.
3. Ejecutar `node.exe scripts/validation/apply-v4.1.mjs --check`, después `--apply` y nuevamente `--check`.
4. Ejecutar `INVENTORY_SYNC_ENABLED=false node.exe --import tsx scripts/validation/recover-v4-e2e.mjs --inspect V4_E2E_2fe98f82087b`.
5. Evaluar la lista de IDs y los conteos en la salida.
6. Ejecutar **solo con POS/workers detenidos** la simulación del mismo script `--dry-run`, con `POS_INTEGRAL_ALLOW_WRITES=SI POS_INTEGRAL_WORKERS_STOPPED=SI POS_ALLOW_TEST_DB=SI INVENTORY_SYNC_ENABLED=false`. Esta simulación usa una única transacción y fuerza `ROLLBACK`.
7. Si el ensayo es `PASS`, ejecutar `--apply` con las mismas variables y `POS_V4_RECOVERY_CONFIRM=V4_E2E_2fe98f82087b`. Esta operación elimina SOLO los datos que estén relacionados con el fixture sintético identificado y verificado, dentro de una única transacción. No modifica ni deshabilita triggers ni borra otras empresas.
8. Confirmar que no existan `V4_E2E_%` ni `V4_TENANT_%` residuales y ejecutar `run-v4.mjs --full` de nuevo.

## Límites

- El código fue inspeccionado y la sintaxis comprobada, pero **la recuperación no se ha ejecutado contra PostgreSQL local del usuario**.
- Una prueba de simulado puede fallar por otra relación o trigger: no aplicar cambios si ocurre.
- No se incluyen migraciones, backups, ni commits. Si hay otro marcador, el script lo rechaza.
- Borrar este fixture NO borra los registros históricos ajenos. Las secuencias autoincrementales pueden continuar avanzadas.
- No aprobar producción solo por ejecutar las pruebas: el Ecommerce usa mock y los SLO son provisionales.
