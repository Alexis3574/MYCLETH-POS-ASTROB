import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { loadBranchAccess } from "../inventory/authorization/branch-access.js";
import {
  resolveDashboardPeriod,
  type DashboardQuery,
} from "./dashboard.schema.js";

export type DashboardActor = {
  empresaId: bigint;
  userId: bigint;
};

export class DashboardError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;

type DashboardScope = {
  empresaId: bigint;
  branches?: bigint[];
};

const formatMoney = (value: Prisma.Decimal | null) =>
  (value ?? new Prisma.Decimal(0)).toFixed(2);

const branchFilter = (scope: DashboardScope) =>
  scope.branches
    ? Prisma.sql`AND s.id IN (${Prisma.join(scope.branches)})`
    : Prisma.empty;

async function permissionsOf(
  tx: Tx,
  userId: bigint,
): Promise<Set<string>> {
  const assignments = await tx.usuario_rol.findMany({
    where: {
      usuario_id: userId,
      rol: { activo: true },
    },
    select: {
      rol: {
        select: {
          rol_permiso: {
            select: {
              permiso: {
                select: { codigo: true },
              },
            },
          },
        },
      },
    },
  });

  return new Set(assignments.flatMap(item =>
    item.rol.rol_permiso.map(link =>
      link.permiso.codigo
    )
  ));
}

async function salesSummary(
  tx: Tx,
  scope: DashboardScope,
  start: Date,
  end: Date,
  from: string,
  to: string,
  timezone: string,
) {
  const branches = scope.branches
    ? { sucursal_id: { in: scope.branches } }
    : {};

  const salesWhere: Prisma.ventaWhereInput = {
    empresa_id: scope.empresaId,
    estado: "COMPLETADA",
    fecha: { gte: start, lt: end },
    sucursal: {
      empresa_id: scope.empresaId,
      activo: true,
    },
    ...branches,
  };

  const returnsWhere: Prisma.devolucion_ventaWhereInput = {
    fecha: { gte: start, lt: end },
    venta: {
      empresa_id: scope.empresaId,
      estado: "COMPLETADA",
      sucursal: {
        empresa_id: scope.empresaId,
        activo: true,
      },
      ...branches,
    },
  };

  const sales = await tx.venta.aggregate({
    where: salesWhere,
    _count: { _all: true },
    _sum: { total: true },
  });

  const returns = await tx.devolucion_venta.aggregate({
    where: returnsWhere,
    _count: { _all: true },
    _sum: { total: true },
  });

  const gross =
    sales._sum.total ?? new Prisma.Decimal(0);

  const refunded =
    returns._sum.total ?? new Prisma.Decimal(0);

  const filter = branchFilter(scope);

  const trend = await tx.$queryRaw<Array<{
    fecha: string;
    ventas_brutas: string;
    devoluciones: string;
    ventas_netas: string;
  }>>`
    WITH dias AS (
      SELECT generate_series(
        ${from}::date,
        ${to}::date,
        INTERVAL '1 day'
      )::date AS fecha
    ),
    ventas AS (
      SELECT
        (v.fecha AT TIME ZONE ${timezone})::date AS fecha,
        SUM(v.total) AS importe
      FROM pos.venta v
      JOIN pos.sucursal s
        ON s.id = v.sucursal_id
       AND s.empresa_id = v.empresa_id
      WHERE v.empresa_id = ${scope.empresaId}
        AND v.estado = 'COMPLETADA'
        AND s.activo = TRUE
        AND v.fecha >= ${start}
        AND v.fecha < ${end}
        ${filter}
      GROUP BY 1
    ),
    devoluciones AS (
      SELECT
        (d.fecha AT TIME ZONE ${timezone})::date AS fecha,
        SUM(d.total) AS importe
      FROM pos.devolucion_venta d
      JOIN pos.venta v ON v.id = d.venta_id
      JOIN pos.sucursal s
        ON s.id = v.sucursal_id
       AND s.empresa_id = v.empresa_id
      WHERE v.empresa_id = ${scope.empresaId}
        AND v.estado = 'COMPLETADA'
        AND s.activo = TRUE
        AND d.fecha >= ${start}
        AND d.fecha < ${end}
        ${filter}
      GROUP BY 1
    )
    SELECT
      dias.fecha::text AS fecha,
      COALESCE(ventas.importe, 0)::numeric(18,2)::text
        AS ventas_brutas,
      COALESCE(devoluciones.importe, 0)::numeric(18,2)::text
        AS devoluciones,
      (
        COALESCE(ventas.importe, 0) -
        COALESCE(devoluciones.importe, 0)
      )::numeric(18,2)::text AS ventas_netas
    FROM dias
    LEFT JOIN ventas USING (fecha)
    LEFT JOIN devoluciones USING (fecha)
    ORDER BY dias.fecha
  `;

  return {
    operaciones: sales._count._all,
    devoluciones_registradas: returns._count._all,
    ventas_brutas: formatMoney(gross),
    monto_devuelto: formatMoney(refunded),
    ventas_netas: gross.minus(refunded).toFixed(2),
    ticket_promedio: sales._count._all
      ? gross.div(sales._count._all).toFixed(2)
      : "0.00",
    tendencia_diaria: trend,
  };
}

async function cashSummary(
  tx: Tx,
  scope: DashboardScope,
) {
  const branchScope = scope.branches
    ? { sucursal_id: { in: scope.branches } }
    : {};

  const registers = await tx.caja.count({
    where: {
      activo: true,
      sucursal: {
        empresa_id: scope.empresaId,
        activo: true,
      },
      ...branchScope,
    },
  });

  const openSessions = await tx.sesion_caja.count({
    where: {
      estado: "ABIERTA",
      caja: {
        activo: true,
        sucursal: {
          empresa_id: scope.empresaId,
          activo: true,
        },
        ...branchScope,
      },
    },
  });

  return {
    cajas_activas: registers,
    sesiones_abiertas: openSessions,
  };
}

async function inventorySummary(
  tx: Tx,
  scope: DashboardScope,
) {
  const filter = branchFilter(scope);

  const rows = await tx.$queryRaw<Array<{
    existencias: string;
    bajo_minimo: string;
    agotadas: string;
  }>>`
    SELECT
      COUNT(*)::text AS existencias,
      COUNT(*) FILTER (
        WHERE e.disponible < p.stock_minimo
      )::text AS bajo_minimo,
      COUNT(*) FILTER (
        WHERE e.disponible <= 0
      )::text AS agotadas
    FROM pos.existencia e
    JOIN pos.producto p
      ON p.id = e.producto_id
    JOIN pos.almacen a
      ON a.id = e.almacen_id
    JOIN pos.sucursal s
      ON s.id = a.sucursal_id
    WHERE p.empresa_id = ${scope.empresaId}
      AND s.empresa_id = p.empresa_id
      AND p.activo = TRUE
      AND p.controla_inventario = TRUE
      AND a.activo = TRUE
      AND s.activo = TRUE
      ${filter}
  `;

  const row = rows[0];

  return {
    existencias_registradas: Number(row?.existencias ?? 0),
    bajo_minimo: Number(row?.bajo_minimo ?? 0),
    agotadas: Number(row?.agotadas ?? 0),
  };
}

async function ecommerceSummary(
  tx: Tx,
  scope: DashboardScope,
) {
  const filter = branchFilter(scope);

  const rows = await tx.$queryRaw<Array<{
    pendientes_o_error: string;
  }>>`
    SELECT
      COUNT(*) FILTER (
        WHERE si.estado <> 'SINCRONIZADO'
      )::text AS pendientes_o_error
    FROM pos.sincronizacion_ecommerce_inventario si
    JOIN pos.movimiento_inventario mi
      ON mi.id = si.movimiento_inventario_id
    JOIN pos.almacen a
      ON a.id = mi.almacen_id
    JOIN pos.sucursal s
      ON s.id = a.sucursal_id
    WHERE s.empresa_id = ${scope.empresaId}
      AND s.activo = TRUE
      ${filter}
  `;

  return {
    pendientes_o_error: Number(
      rows[0]?.pendientes_o_error ?? 0
    ),
  };
}

export const dashboardService = {
  async summary(
    actor: DashboardActor,
    query: DashboardQuery,
  ) {
    return prisma.$transaction(async tx => {
      const account = await tx.usuario.findFirst({
        where: {
          id: actor.userId,
          empresa_id: actor.empresaId,
          activo: true,
          bloqueado: false,
        },
        select: { id: true },
      });

      const company = await tx.empresa.findFirst({
        where: {
          id: actor.empresaId,
          activo: true,
        },
        select: {
          id: true,
          moneda: true,
          zona_horaria: true,
        },
      });

      if (!account || !company) {
        throw new DashboardError(
          403,
          "DASHBOARD_FORBIDDEN",
          "Usuario o empresa no disponible.",
        );
      }

      const permissions = await permissionsOf(
        tx,
        actor.userId,
      );

      if (!permissions.has("DASHBOARD.VER")) {
        throw new DashboardError(
          403,
          "DASHBOARD_FORBIDDEN",
          "Acceso no autorizado.",
        );
      }

      const access = await loadBranchAccess(tx, actor);

      let branches: bigint[] | undefined =
        access.global
          ? undefined
          : [...access.sucursalIds];

      if (query.sucursal_id !== undefined) {
        const branch = await tx.sucursal.findFirst({
          where: {
            id: query.sucursal_id,
            empresa_id: actor.empresaId,
            activo: true,
          },
          select: { id: true },
        });

        if (
          !branch ||
          (
            !access.global &&
            !access.sucursalIds.includes(branch.id)
          )
        ) {
          throw new DashboardError(
            404,
            "DASHBOARD_BRANCH_NOT_FOUND",
            "Sucursal no disponible.",
          );
        }

        branches = [branch.id];
      }

      if (branches?.length === 0) {
        throw new DashboardError(
          403,
          "DASHBOARD_NO_BRANCH_ACCESS",
          "Sin sucursales autorizadas.",
        );
      }

      let period;

      try {
        period = resolveDashboardPeriod(
          query,
          company.zona_horaria,
        );
      } catch {
        throw new DashboardError(
          400,
          "DASHBOARD_INVALID_PERIOD",
          "El periodo debe ser válido y no exceder 31 días.",
        );
      }

      const bounds = await tx.$queryRaw<Array<{
        inicio: Date;
        fin: Date;
      }>>`
        SELECT
          (
            ${period.desde}::date::timestamp
            AT TIME ZONE ${company.zona_horaria}
          ) AS inicio,
          (
            (${period.hasta}::date + INTERVAL '1 day')
            AT TIME ZONE ${company.zona_horaria}
          ) AS fin
      `;

      const interval = bounds[0];

      if (!interval) {
        throw new Error("No se pudo resolver el periodo.");
      }

      const scope: DashboardScope = {
        empresaId: actor.empresaId,
        branches,
      };

      const indicators: Record<string, unknown> = {};

      // Consultas secuenciales dentro de la misma transacción.
      if (permissions.has("VENTAS.VER")) {
        indicators.ventas = await salesSummary(
          tx, scope,
          interval.inicio, interval.fin,
          period.desde, period.hasta,
          company.zona_horaria,
        );
      }

      if (permissions.has("CAJAS.VER")) {
        indicators.caja = await cashSummary(tx, scope);
      }

      if (permissions.has("INVENTARIO.VER")) {
        indicators.inventario =
          await inventorySummary(tx, scope);
      }

      if (permissions.has("ECOMMERCE_SYNC.VER")) {
        indicators.ecommerce =
          await ecommerceSummary(tx, scope);
      }

      return {
        periodo: {
          fecha_desde: period.desde,
          fecha_hasta: period.hasta,
          zona_horaria: company.zona_horaria,
          moneda: company.moneda,
        },
        sucursal_id:
          query.sucursal_id?.toString() ?? null,
        indicadores: indicators,
      };
    }, {
      isolationLevel:
        Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20000,
    });
  },
};
