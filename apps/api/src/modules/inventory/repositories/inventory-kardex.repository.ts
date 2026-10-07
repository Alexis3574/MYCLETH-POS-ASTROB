import type { InventoryTransaction, KardexQuery } from "../types/inventory.types.js";

export interface KardexSummary {
  total: string; saldo_base: string; saldo_inicial: string; saldo_final: string; entradas: string; salidas: string;
}
export interface KardexRow {
  id: bigint; tipo: string; cantidad: string; delta: string; saldo_antes: string; saldo_despues: string;
  costo_unitario: string | null; documento_tipo: string | null; documento_id: bigint | null;
  documento_detalle_id: bigint | null; usuario_id: bigint | null; motivo: string | null; fecha: Date;
}

export const inventoryKardexRepository = {
  async summary(tx: InventoryTransaction, empresaId: bigint, query: KardexQuery) {
    const from = query.fecha_desde ?? null;
    const to = query.fecha_hasta ?? null;
    const rows = await tx.$queryRaw<KardexSummary[]>`
      WITH movimientos AS (
        SELECT m.fecha,
          CASE WHEN m.tipo IN ('ENTRADA', 'AJUSTE_POSITIVO', 'TRANSFERENCIA_ENTRADA') THEN m.cantidad ELSE -m.cantidad END AS delta
        FROM pos.movimiento_inventario m
        JOIN pos.producto p ON p.id = m.producto_id
        JOIN pos.almacen a ON a.id = m.almacen_id
        JOIN pos.sucursal s ON s.id = a.sucursal_id
        WHERE m.producto_id = ${query.producto_id} AND m.almacen_id = ${query.almacen_id}
          AND p.empresa_id = ${empresaId} AND s.empresa_id = ${empresaId}
      ), base AS (
        SELECT COALESCE((SELECT e.cantidad FROM pos.existencia e WHERE e.producto_id = ${query.producto_id} AND e.almacen_id = ${query.almacen_id}), 0)
          - COALESCE(SUM(delta), 0) AS saldo FROM movimientos
      )
      SELECT
        (SELECT COUNT(*) FROM movimientos WHERE (${from}::timestamptz IS NULL OR fecha >= ${from}::timestamptz) AND (${to}::timestamptz IS NULL OR fecha <= ${to}::timestamptz))::text AS total,
        b.saldo::text AS saldo_base,
        (b.saldo + COALESCE((SELECT SUM(delta) FROM movimientos WHERE fecha < ${from}::timestamptz), 0))::text AS saldo_inicial,
        (b.saldo + COALESCE((SELECT SUM(delta) FROM movimientos WHERE ${to}::timestamptz IS NULL OR fecha <= ${to}::timestamptz), 0))::text AS saldo_final,
        COALESCE((SELECT SUM(delta) FROM movimientos WHERE delta > 0 AND (${from}::timestamptz IS NULL OR fecha >= ${from}::timestamptz) AND (${to}::timestamptz IS NULL OR fecha <= ${to}::timestamptz)), 0)::text AS entradas,
        COALESCE((SELECT SUM(-delta) FROM movimientos WHERE delta < 0 AND (${from}::timestamptz IS NULL OR fecha >= ${from}::timestamptz) AND (${to}::timestamptz IS NULL OR fecha <= ${to}::timestamptz)), 0)::text AS salidas
      FROM base b
    `;
    if (!rows[0]) throw new Error("No se pudo calcular el resumen del kardex.");
    return rows[0];
  },
  rows(tx: InventoryTransaction, empresaId: bigint, query: KardexQuery) {
    const from = query.fecha_desde ?? null;
    const to = query.fecha_hasta ?? null;
    return tx.$queryRaw<KardexRow[]>`
      WITH movimientos AS (
        SELECT m.*, CASE WHEN m.tipo IN ('ENTRADA', 'AJUSTE_POSITIVO', 'TRANSFERENCIA_ENTRADA') THEN m.cantidad ELSE -m.cantidad END AS delta
        FROM pos.movimiento_inventario m
        JOIN pos.producto p ON p.id = m.producto_id
        JOIN pos.almacen a ON a.id = m.almacen_id
        JOIN pos.sucursal s ON s.id = a.sucursal_id
        WHERE m.producto_id = ${query.producto_id} AND m.almacen_id = ${query.almacen_id}
          AND p.empresa_id = ${empresaId} AND s.empresa_id = ${empresaId}
      ), base AS (
        SELECT COALESCE((SELECT e.cantidad FROM pos.existencia e WHERE e.producto_id = ${query.producto_id} AND e.almacen_id = ${query.almacen_id}), 0)
          - COALESCE(SUM(delta), 0) AS saldo FROM movimientos
      ), acumulados AS (
        SELECT m.*, b.saldo + SUM(m.delta) OVER (ORDER BY m.fecha, m.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo_despues
        FROM movimientos m CROSS JOIN base b
      )
      SELECT id, tipo, cantidad::text AS cantidad, delta::text AS delta,
        (saldo_despues - delta)::text AS saldo_antes, saldo_despues::text AS saldo_despues,
        costo_unitario::text AS costo_unitario, documento_tipo, documento_id, documento_detalle_id,
        usuario_id, motivo, fecha
      FROM acumulados
      WHERE (${from}::timestamptz IS NULL OR fecha >= ${from}::timestamptz)
        AND (${to}::timestamptz IS NULL OR fecha <= ${to}::timestamptz)
      ORDER BY fecha ASC, id ASC
      LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
    `;
  },
};
