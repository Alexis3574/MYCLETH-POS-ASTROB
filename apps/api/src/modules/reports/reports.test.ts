import test from "node:test";
import assert from "node:assert/strict";

import {
  parseReportQuery,
  resolveReportPeriod,
} from "./reports.schema.js";

import {
  csvCell,
  buildReportCsv,
} from "./reports.csv.js";

test("M17: ventas acepta filtros validos", () => {
  const result = parseReportQuery("ventas", {
    fecha_desde: "2026-09-25",
    fecha_hasta: "2026-10-03",
    estado: "COMPLETADA",
    page: "2",
    limit: "50",
  });

  assert.equal(result.page, 2);
  assert.equal(result.limit, 50);
  assert.equal(result.estado, "COMPLETADA");
});

test("M17: paginacion predeterminada", () => {
  const result = parseReportQuery("compras", {});

  assert.equal(result.page, 1);
  assert.equal(result.limit, 20);
});

test("M17: rechaza fechas inexistentes", () => {
  assert.throws(() =>
    parseReportQuery("ventas", {
      fecha_desde: "2026-02-30",
    })
  );
});

test("M17: rechaza empresa manipulada", () => {
  assert.throws(() =>
    parseReportQuery("ventas", {
      empresa_id: "2",
    })
  );
});

test("M17: rechaza filtros de otro reporte", () => {
  assert.throws(() =>
    parseReportQuery("existencias", {
      estado: "COMPLETADA",
    })
  );
});

test("M17: valida ID de sucursal", () => {
  assert.throws(() =>
    parseReportQuery("caja", {
      sucursal_id: "0",
    })
  );
});

test("M17: fecha inicial y final correctas", () => {
  const query = parseReportQuery("ventas", {
    fecha_desde: "2026-09-25",
    fecha_hasta: "2026-10-03",
  });

  assert.deepEqual(
    resolveReportPeriod(
      query,
      "America/Mexico_City",
    ),
    {
      desde: "2026-09-25",
      hasta: "2026-10-03",
    },
  );
});

test("M17: rechaza periodo invertido", () => {
  assert.throws(() =>
    resolveReportPeriod(
      parseReportQuery("ventas", {
        fecha_desde: "2026-11-02",
        fecha_hasta: "2026-10-01",
      }),
      "America/Mexico_City",
    )
  );
});

test("M17: rechaza periodos mayores de 366 dias", () => {
  assert.throws(() =>
    resolveReportPeriod(
      parseReportQuery("ventas", {
        fecha_desde: "2025-01-01",
        fecha_hasta: "2026-11-02",
      }),
      "America/Mexico_City",
    )
  );
});

test("M17: periodo predeterminado de 30 dias", () => {
  const period = resolveReportPeriod(
    parseReportQuery("ventas", {}),
    "America/Mexico_City",
    new Date("2026-11-02T16:00:00Z"),
  );

  assert.deepEqual(period, {
    desde: "2026-10-04",
    hasta: "2026-11-02",
  });
});

test("M17: CSV neutraliza formulas", () => {
  assert.equal(
    csvCell("=SUM(A1:A2)"),
    '"\'=SUM(A1:A2)"',
  );

  assert.equal(
    csvCell("-cmd"),
    '"\'-cmd"',
  );

  assert.equal(
    csvCell("-10.00"),
    '"-10.00"',
  );
});

test("M17: CSV escapa comillas", () => {
  assert.equal(
    csvCell('Nombre "especial"'),
    '"Nombre ""especial"""',
  );
});

test("M17: CSV conserva encabezado sin registros", () => {
  const result = buildReportCsv("compras", []);

  assert.ok(result.startsWith("\uFEFF"));
  assert.ok(result.includes('"Folio"'));
  assert.ok(result.endsWith("\r\n"));
});
