import { z } from "zod";

export const reportKinds = [
  "ventas",
  "devoluciones",
  "compras",
  "inventario",
  "existencias",
  "caja",
] as const;

export type ReportKind = typeof reportKinds[number];

const date = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value;
  }, "Fecha calendario invalida.");

const id = z.string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine(value =>
    BigInt(value) <= 9223372036854775807n
  )
  .transform(BigInt);

const pagination = {
  page: z.coerce.number()
    .int().min(1).max(100000).default(1),
  limit: z.coerce.number()
    .int().min(1).max(100).default(20),
};

const period = {
  fecha_desde: date.optional(),
  fecha_hasta: date.optional(),
};

const scope = {
  sucursal_id: id.optional(),
};

const schemas = {
  ventas: z.strictObject({
    ...period,
    ...scope,
    ...pagination,
    estado: z.enum([
      "BORRADOR",
      "COMPLETADA",
      "CANCELADA",
    ]).optional(),
    condicion_pago: z.string().trim()
      .min(1).max(20).optional(),
    folio: z.string().trim()
      .min(1).max(50).optional(),
  }),

  devoluciones: z.strictObject({
    ...period,
    ...scope,
    ...pagination,
    folio: z.string().trim()
      .min(1).max(50).optional(),
  }),

  compras: z.strictObject({
    ...period,
    ...scope,
    ...pagination,
    estado: z.enum([
      "BORRADOR",
      "RECIBIDA",
      "CANCELADA",
    ]).optional(),
    proveedor_id: id.optional(),
  }),

  inventario: z.strictObject({
    ...period,
    ...scope,
    ...pagination,
    almacen_id: id.optional(),
    producto_id: id.optional(),
    tipo: z.enum([
      "ENTRADA",
      "SALIDA",
      "AJUSTE_POSITIVO",
      "AJUSTE_NEGATIVO",
    ]).optional(),
  }),

  existencias: z.strictObject({
    ...scope,
    ...pagination,
    almacen_id: id.optional(),
    producto_id: id.optional(),
  }),

  caja: z.strictObject({
    ...period,
    ...scope,
    ...pagination,
    sesion_caja_id: id.optional(),
    tipo: z.enum([
      "ENTRADA",
      "SALIDA",
    ]).optional(),
  }),
};

export interface ReportQuery {
  fecha_desde?: string;
  fecha_hasta?: string;
  sucursal_id?: bigint;
  almacen_id?: bigint;
  producto_id?: bigint;
  proveedor_id?: bigint;
  sesion_caja_id?: bigint;
  estado?: string;
  condicion_pago?: string;
  folio?: string;
  tipo?: string;
  page: number;
  limit: number;
}

export function parseReportQuery(
  kind: ReportKind,
  query: unknown,
): ReportQuery {
  return schemas[kind].parse(query) as ReportQuery;
}

function dateInZone(
  now: Date,
  timezone: string,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (part: string) =>
    parts.find(item => item.type === part)?.value;

  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function resolveReportPeriod(
  query: ReportQuery,
  timezone: string,
  now = new Date(),
) {
  const until = query.fecha_hasta ??
    dateInZone(now, timezone);

  const untilTime =
    Date.parse(`${until}T00:00:00.000Z`);

  const since = query.fecha_desde ??
    new Date(untilTime - 29 * 86400000)
      .toISOString().slice(0, 10);

  const sinceTime =
    Date.parse(`${since}T00:00:00.000Z`);

  const days =
    (untilTime - sinceTime) / 86400000;

  if (
    !Number.isInteger(days) ||
    days < 0 ||
    days > 365
  ) {
    throw new Error("REPORT_INVALID_PERIOD");
  }

  return {
    desde: since,
    hasta: until,
  };
}
