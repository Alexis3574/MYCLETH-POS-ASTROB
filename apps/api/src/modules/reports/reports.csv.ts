import type { ReportKind } from "./reports.schema.js";

export type ReportRow =
  Record<string, string | number | boolean | null>;

const columns: Record<
  ReportKind,
  readonly (readonly [string, string])[]
> = {
  ventas: [
    ["id", "ID"],
    ["folio", "Folio"],
    ["fecha", "Fecha"],
    ["sucursal", "Sucursal"],
    ["estado", "Estado"],
    ["condicion_pago", "Condicion de pago"],
    ["subtotal", "Subtotal"],
    ["descuento", "Descuento"],
    ["impuesto", "Impuesto"],
    ["total", "Total"],
  ],

  devoluciones: [
    ["id", "ID"],
    ["folio", "Folio devolucion"],
    ["fecha", "Fecha"],
    ["sucursal", "Sucursal"],
    ["venta_folio", "Folio venta"],
    ["motivo", "Motivo"],
    ["subtotal", "Subtotal"],
    ["impuesto", "Impuesto"],
    ["total", "Total"],
  ],

  compras: [
    ["id", "ID"],
    ["folio", "Folio"],
    ["fecha", "Fecha"],
    ["sucursal", "Sucursal"],
    ["proveedor_id", "Proveedor ID"],
    ["estado", "Estado"],
    ["subtotal", "Subtotal"],
    ["descuento", "Descuento"],
    ["impuesto", "Impuesto"],
    ["total", "Total"],
  ],

  inventario: [
    ["id", "ID"],
    ["fecha", "Fecha"],
    ["sucursal_id", "Sucursal ID"],
    ["almacen", "Almacen"],
    ["sku", "SKU"],
    ["producto", "Producto"],
    ["tipo", "Tipo"],
    ["cantidad", "Cantidad"],
    ["costo_unitario", "Costo unitario"],
    ["documento_tipo", "Documento tipo"],
    ["documento_id", "Documento ID"],
  ],

  existencias: [
    ["producto_id", "Producto ID"],
    ["sku", "SKU"],
    ["producto", "Producto"],
    ["sucursal_id", "Sucursal ID"],
    ["almacen", "Almacen"],
    ["cantidad", "Cantidad"],
    ["reservado", "Reservado"],
    ["disponible", "Disponible"],
    ["stock_minimo", "Stock minimo"],
    ["bajo_minimo", "Bajo minimo"],
    ["agotado", "Agotado"],
  ],

  caja: [
    ["id", "ID"],
    ["fecha", "Fecha"],
    ["sucursal_id", "Sucursal ID"],
    ["caja", "Caja"],
    ["sesion_caja_id", "Sesion ID"],
    ["tipo", "Tipo"],
    ["concepto", "Concepto"],
    ["monto", "Monto"],
    ["referencia", "Referencia"],
  ],
};

export function csvCell(
  value: string | number | boolean | null | undefined,
): string {
  let text = value === null || value === undefined
    ? ""
    : String(value);

  text = text.replace(/\u0000/g, "");

  // Detecta formulas incluso tras caracteres invisibles.
  // Conserva numeros negativos decimales legitimos.
  const firstVisible = text.replace(
    /^[\s\u0001-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+/u,
    "",
  );

  const ordinaryNegative =
    /^-\d+(?:\.\d+)?$/.test(text);

  if (
    !ordinaryNegative &&
    /^[=+\-@]/.test(firstVisible)
  ) {
    text = "'" + text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export function buildReportCsv(
  kind: ReportKind,
  rows: ReportRow[],
): string {
  const definition = columns[kind];

  const lines = [
    definition.map(([, label]) => csvCell(label))
      .join(","),
  ];

  for (const row of rows) {
    lines.push(
      definition.map(([key]) =>
        csvCell(row[key])
      ).join(",")
    );
  }

  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
