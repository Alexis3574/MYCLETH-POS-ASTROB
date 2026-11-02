import { z } from "zod";

const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value;
  }, "Fecha calendario inválida.");

const positiveId = z.string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine(value =>
    BigInt(value) <= 9223372036854775807n
  )
  .transform(value => BigInt(value));

export const dashboardQuerySchema = z.strictObject({
  fecha_desde: dateSchema.optional(),
  fecha_hasta: dateSchema.optional(),
  sucursal_id: positiveId.optional(),
});

export type DashboardQuery =
  z.infer<typeof dashboardQuerySchema>;

function dateInZone(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const part = (name: string) =>
    parts.find(item => item.type === name)?.value;

  return `${part("year")}-${part("month")}-${part("day")}`;
}

function previousDate(date: string, days: number): string {
  const timestamp =
    Date.parse(`${date}T00:00:00.000Z`);

  return new Date(timestamp - days * 86400000)
    .toISOString().slice(0, 10);
}

export function resolveDashboardPeriod(
  query: DashboardQuery,
  timezone: string,
  now = new Date(),
) {
  const today = dateInZone(now, timezone);

  const hasta = query.fecha_hasta ?? today;
  const desde = query.fecha_desde ??
    previousDate(hasta, 6);

  const difference =
    (
      Date.parse(`${hasta}T00:00:00.000Z`) -
      Date.parse(`${desde}T00:00:00.000Z`)
    ) / 86400000;

  if (difference < 0 || difference > 30) {
    throw new Error("DASHBOARD_INVALID_PERIOD");
  }

  return { desde, hasta };
}
