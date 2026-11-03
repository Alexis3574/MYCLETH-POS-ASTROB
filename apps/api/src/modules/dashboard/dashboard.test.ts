import test from "node:test";
import assert from "node:assert/strict";

import {
  dashboardQuerySchema,
  resolveDashboardPeriod,
} from "./dashboard.schema.js";

test("M16: consulta vacia valida", () => {
  assert.equal(
    dashboardQuerySchema.safeParse({}).success,
    true,
  );
});

test("M16: rechaza fechas invalidas", () => {
  assert.equal(
    dashboardQuerySchema.safeParse({
      fecha_desde: "2026-02-30",
    }).success,
    false,
  );
});

test("M16: rechaza sucursal invalida", () => {
  assert.equal(
    dashboardQuerySchema.safeParse({
      sucursal_id: "0",
    }).success,
    false,
  );
});

test("M16: rechaza parametros desconocidos", () => {
  assert.equal(
    dashboardQuerySchema.safeParse({
      empresa_id: "2",
    }).success,
    false,
  );
});

test("M16: respeta periodo solicitado", () => {
  const query = dashboardQuerySchema.parse({
    fecha_desde: "2026-09-25",
    fecha_hasta: "2026-10-03",
  });

  assert.deepEqual(
    resolveDashboardPeriod(
      query,
      "America/Mexico_City",
    ),
    {
      desde: "2026-09-25",
      hasta: "2026-10-03",
    },
  );
});

test("M16: bloquea intervalos invertidos", () => {
  assert.throws(() =>
    resolveDashboardPeriod(
      dashboardQuerySchema.parse({
        fecha_desde: "2026-11-02",
        fecha_hasta: "2026-10-01",
      }),
      "America/Mexico_City",
    )
  );
});

test("M16: limita consultas a 31 dias", () => {
  assert.throws(() =>
    resolveDashboardPeriod(
      dashboardQuerySchema.parse({
        fecha_desde: "2026-01-01",
        fecha_hasta: "2026-03-31",
      }),
      "America/Mexico_City",
    )
  );
});

test("M16: calcula siete dias predeterminados", () => {
  const period = resolveDashboardPeriod(
    dashboardQuerySchema.parse({}),
    "America/Mexico_City",
    new Date("2026-11-02T16:00:00Z"),
  );

  assert.deepEqual(period, {
    desde: "2026-10-27",
    hasta: "2026-11-02",
  });
});
