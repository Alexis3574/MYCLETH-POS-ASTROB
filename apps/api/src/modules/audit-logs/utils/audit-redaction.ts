type SafeValue = string | number | boolean | null;
type SafeRecord = Record<string, SafeValue>;

/*
 * Politica de exposicion por lista permitida.
 * Nunca devolver JSONB completo ni objetos anidados sin revisar.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  venta: [
    "folio", "estado", "total", "condicion_pago",
    "unidades_reintegradas"
  ],
  devolucion_venta: [
    "folio", "total", "venta_id"
  ],
  compra: [
    "accion", "estado", "folio"
  ],
  cotizacion: [
    "modulo", "accion", "estado"
  ],
  orden_venta: [
    "modulo", "accion", "estado", "venta_id"
  ],
  pedido_cliente: [
    "modulo", "accion", "estado", "venta_id"
  ],
  sincronizacion_ecommerce_inventario: [
    "modulo", "accion", "estado", "intentos"
  ]
};

export function redactAuditPayload(
  table: string,
  payload: unknown
): SafeRecord | null {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return null;
  }

  const source = payload as Record<string, unknown>;
  const result: SafeRecord = {};

  for (const key of ALLOWED[table] ?? []) {
    const value = source[key];

    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      result[key] = value;
    }
  }

  return result;
}
