import { prisma } from "../../lib/prisma.js";
import {
  Prisma,
} from "../../generated/prisma/client.js";

import {
  loadBranchAccess,
} from "../inventory/authorization/branch-access.js";

import {
  resolveReportPeriod,
  type ReportKind,
  type ReportQuery,
} from "./reports.schema.js";

import type {
  ReportRow,
} from "./reports.csv.js";

type Tx = Prisma.TransactionClient;

export interface ReportActor {
  empresaId: bigint;
  userId: bigint;
}

export class ReportError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const requiredPermissions: Record<ReportKind, string> = {
  ventas: "VENTAS.VER",
  devoluciones: "VENTAS.VER",
  compras: "COMPRAS.VER",
  inventario: "INVENTARIO.VER",
  existencias: "INVENTARIO.VER",
  caja: "CAJAS.VER",
};

const exportLimit = 3000;

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function amount(value: Prisma.Decimal): string {
  return value.toFixed(3);
}

function timestamp(value: Date): string {
  return value.toISOString();
}

async function resolveBounds(
  tx: Tx,
  from: string,
  to: string,
  timezone: string,
) {
  const bounds = await tx.$queryRaw<Array<{
    inicio: Date;
    fin: Date;
  }>>`
    SELECT
      (
        ${from}::date::timestamp
        AT TIME ZONE ${timezone}
      ) AS inicio,
      (
        (${to}::date + INTERVAL '1 day')
        AT TIME ZONE ${timezone}
      ) AS fin
  `;

  if (!bounds[0]) {
    throw new Error("No se pudieron resolver fechas.");
  }

  return {
    gte: bounds[0].inicio,
    lt: bounds[0].fin,
  };
}

async function loadPermissions(
  tx: Tx,
  actor: ReportActor,
): Promise<Set<string>> {
  const user = await tx.usuario.findFirst({
    where: {
      id: actor.userId,
      empresa_id: actor.empresaId,
      activo: true,
      bloqueado: false,
      empresa: { activo: true },
    },
    select: { id: true },
  });

  if (!user) {
    throw new ReportError(
      403,
      "REPORT_FORBIDDEN",
      "Usuario o empresa no disponible.",
    );
  }

  const roles = await tx.usuario_rol.findMany({
    where: {
      usuario_id: actor.userId,
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

  return new Set(
    roles.flatMap(item =>
      item.rol.rol_permiso.map(link =>
        link.permiso.codigo
      )
    )
  );
}

async function authorizedBranches(
  tx: Tx,
  actor: ReportActor,
  query: ReportQuery,
): Promise<Prisma.sucursalWhereInput> {
  const access = await loadBranchAccess(tx, actor);

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
      throw new ReportError(
        404,
        "REPORT_BRANCH_NOT_FOUND",
        "Sucursal no disponible.",
      );
    }

    return {
      id: branch.id,
      empresa_id: actor.empresaId,
      activo: true,
    };
  }

  if (
    !access.global &&
    access.sucursalIds.length === 0
  ) {
    throw new ReportError(
      403,
      "REPORT_NO_BRANCH_ACCESS",
      "Sin sucursales autorizadas.",
    );
  }

  return {
    empresa_id: actor.empresaId,
    activo: true,
    ...(access.global
      ? {}
      : {
          id: { in: access.sucursalIds },
        }),
  };
}

interface ReportResult {
  total: number;
  items: ReportRow[];
}

async function fetchRows(
  tx: Tx,
  actor: ReportActor,
  kind: ReportKind,
  query: ReportQuery,
  branches: Prisma.sucursalWhereInput,
  dates: { gte: Date; lt: Date } | undefined,
  skip: number,
  take: number,
): Promise<ReportResult> {
  if (kind === "ventas") {
    const where: Prisma.ventaWhereInput = {
      empresa_id: actor.empresaId,
      sucursal: branches,
      ...(dates ? { fecha: dates } : {}),
      ...(query.estado
        ? { estado: query.estado }
        : {}),
      ...(query.condicion_pago
        ? { condicion_pago: query.condicion_pago }
        : {}),
      ...(query.folio
        ? {
            folio: {
              contains: query.folio,
              mode: "insensitive",
            },
          }
        : {}),
    };

    const total = await tx.venta.count({ where });

    const rows = await tx.venta.findMany({
      where,
      orderBy: [
        { fecha: "desc" },
        { id: "desc" },
      ],
      skip,
      take,
      select: {
        id: true,
        folio: true,
        fecha: true,
        estado: true,
        condicion_pago: true,
        subtotal: true,
        descuento: true,
        impuesto: true,
        total: true,
        sucursal: {
          select: { nombre: true },
        },
      },
    });

    return {
      total,
      items: rows.map(row => ({
        id: row.id.toString(),
        folio: row.folio,
        fecha: timestamp(row.fecha),
        sucursal: row.sucursal.nombre,
        estado: row.estado,
        condicion_pago: row.condicion_pago,
        subtotal: money(row.subtotal),
        descuento: money(row.descuento),
        impuesto: money(row.impuesto),
        total: money(row.total),
      })),
    };
  }

  if (kind === "devoluciones") {
    const where: Prisma.devolucion_ventaWhereInput = {
      venta: {
        empresa_id: actor.empresaId,
        sucursal: branches,
      },
      ...(dates ? { fecha: dates } : {}),
      ...(query.folio
        ? {
            folio: {
              contains: query.folio,
              mode: "insensitive",
            },
          }
        : {}),
    };

    const total = await tx.devolucion_venta.count({
      where,
    });

    const rows = await tx.devolucion_venta.findMany({
      where,
      orderBy: [
        { fecha: "desc" },
        { id: "desc" },
      ],
      skip,
      take,
      select: {
        id: true,
        folio: true,
        fecha: true,
        motivo: true,
        subtotal: true,
        impuesto: true,
        total: true,
        venta: {
          select: {
            folio: true,
            sucursal: {
              select: { nombre: true },
            },
          },
        },
      },
    });

    return {
      total,
      items: rows.map(row => ({
        id: row.id.toString(),
        folio: row.folio,
        fecha: timestamp(row.fecha),
        sucursal: row.venta.sucursal.nombre,
        venta_folio: row.venta.folio,
        motivo: row.motivo,
        subtotal: money(row.subtotal),
        impuesto: money(row.impuesto),
        total: money(row.total),
      })),
    };
  }

  if (kind === "compras") {
    const where: Prisma.compraWhereInput = {
      empresa_id: actor.empresaId,
      sucursal: branches,
      ...(dates ? { fecha: dates } : {}),
      ...(query.estado
        ? { estado: query.estado }
        : {}),
      ...(query.proveedor_id
        ? { proveedor_id: query.proveedor_id }
        : {}),
    };

    const total = await tx.compra.count({ where });

    const rows = await tx.compra.findMany({
      where,
      orderBy: [
        { fecha: "desc" },
        { id: "desc" },
      ],
      skip,
      take,
      select: {
        id: true,
        folio: true,
        fecha: true,
        proveedor_id: true,
        estado: true,
        subtotal: true,
        descuento: true,
        impuesto: true,
        total: true,
        sucursal: {
          select: { nombre: true },
        },
      },
    });

    return {
      total,
      items: rows.map(row => ({
        id: row.id.toString(),
        folio: row.folio,
        fecha: timestamp(row.fecha),
        sucursal: row.sucursal.nombre,
        proveedor_id: row.proveedor_id.toString(),
        estado: row.estado,
        subtotal: money(row.subtotal),
        descuento: money(row.descuento),
        impuesto: money(row.impuesto),
        total: money(row.total),
      })),
    };
  }

  if (kind === "inventario") {
    const where: Prisma.movimiento_inventarioWhereInput = {
      producto: {
        empresa_id: actor.empresaId,
      },
      almacen: {
        sucursal: branches,
      },
      ...(dates ? { fecha: dates } : {}),
      ...(query.almacen_id
        ? { almacen_id: query.almacen_id }
        : {}),
      ...(query.producto_id
        ? { producto_id: query.producto_id }
        : {}),
      ...(query.tipo
        ? { tipo: query.tipo }
        : {}),
    };

    const total = await tx.movimiento_inventario.count({
      where,
    });

    const rows = await tx.movimiento_inventario.findMany({
      where,
      orderBy: [
        { fecha: "desc" },
        { id: "desc" },
      ],
      skip,
      take,
      select: {
        id: true,
        fecha: true,
        tipo: true,
        cantidad: true,
        costo_unitario: true,
        documento_tipo: true,
        documento_id: true,
        almacen: {
          select: {
            nombre: true,
            sucursal_id: true,
          },
        },
        producto: {
          select: {
            sku: true,
            nombre: true,
          },
        },
      },
    });

    return {
      total,
      items: rows.map(row => ({
        id: row.id.toString(),
        fecha: timestamp(row.fecha),
        sucursal_id:
          row.almacen.sucursal_id.toString(),
        almacen: row.almacen.nombre,
        sku: row.producto.sku,
        producto: row.producto.nombre,
        tipo: row.tipo,
        cantidad: amount(row.cantidad),
        costo_unitario:
          row.costo_unitario?.toFixed(4) ?? null,
        documento_tipo: row.documento_tipo,
        documento_id:
          row.documento_id?.toString() ?? null,
      })),
    };
  }

  if (kind === "existencias") {
    const where: Prisma.existenciaWhereInput = {
      producto: {
        empresa_id: actor.empresaId,
        activo: true,
        controla_inventario: true,
      },
      almacen: {
        activo: true,
        sucursal: branches,
      },
      ...(query.almacen_id
        ? { almacen_id: query.almacen_id }
        : {}),
      ...(query.producto_id
        ? { producto_id: query.producto_id }
        : {}),
    };

    const total = await tx.existencia.count({
      where,
    });

    const rows = await tx.existencia.findMany({
      where,
      orderBy: [
        { producto_id: "asc" },
        { almacen_id: "asc" },
      ],
      skip,
      take,
      select: {
        producto_id: true,
        cantidad: true,
        reservado: true,
        disponible: true,
        almacen: {
          select: {
            nombre: true,
            sucursal_id: true,
          },
        },
        producto: {
          select: {
            sku: true,
            nombre: true,
            stock_minimo: true,
          },
        },
      },
    });

    return {
      total,
      items: rows.map(row => ({
        producto_id: row.producto_id.toString(),
        sku: row.producto.sku,
        producto: row.producto.nombre,
        sucursal_id:
          row.almacen.sucursal_id.toString(),
        almacen: row.almacen.nombre,
        cantidad: amount(row.cantidad),
        reservado: amount(row.reservado),
        disponible: row.disponible?.toFixed(3) ?? null,
        stock_minimo:
          row.producto.stock_minimo.toFixed(3),
        bajo_minimo:
          row.disponible === null
            ? false
            : row.disponible.lt(
                row.producto.stock_minimo
              ),
        agotado:
          row.disponible === null
            ? false
            : row.disponible.lte(0),
      })),
    };
  }

  const where: Prisma.movimiento_cajaWhereInput = {
    sesion_caja: {
      caja: {
        sucursal: branches,
      },
    },
    ...(dates ? { fecha: dates } : {}),
    ...(query.sesion_caja_id
      ? { sesion_caja_id: query.sesion_caja_id }
      : {}),
    ...(query.tipo
      ? { tipo: query.tipo }
      : {}),
  };

  const total = await tx.movimiento_caja.count({
    where,
  });

  const rows = await tx.movimiento_caja.findMany({
    where,
    orderBy: [
      { fecha: "desc" },
      { id: "desc" },
    ],
    skip,
    take,
    select: {
      id: true,
      fecha: true,
      tipo: true,
      concepto: true,
      monto: true,
      referencia: true,
      sesion_caja_id: true,
      sesion_caja: {
        select: {
          caja: {
            select: {
              nombre: true,
              sucursal_id: true,
            },
          },
        },
      },
    },
  });

  return {
    total,
    items: rows.map(row => ({
      id: row.id.toString(),
      fecha: timestamp(row.fecha),
      sucursal_id:
        row.sesion_caja.caja.sucursal_id.toString(),
      caja: row.sesion_caja.caja.nombre,
      sesion_caja_id:
        row.sesion_caja_id.toString(),
      tipo: row.tipo,
      concepto: row.concepto,
      monto: money(row.monto),
      referencia: row.referencia,
    })),
  };
}

export const reportsService = {
  async list(
    actor: ReportActor,
    kind: ReportKind,
    query: ReportQuery,
    exportMode = false,
  ) {
    return prisma.$transaction(async tx => {
      const company = await tx.empresa.findFirst({
        where: {
          id: actor.empresaId,
          activo: true,
        },
        select: {
          moneda: true,
          zona_horaria: true,
        },
      });

      if (!company) {
        throw new ReportError(
          403,
          "REPORT_FORBIDDEN",
          "Empresa no disponible.",
        );
      }

      const permissions = await loadPermissions(
        tx,
        actor,
      );

      if (
        !permissions.has("REPORTES.VER") ||
        !permissions.has(requiredPermissions[kind])
      ) {
        throw new ReportError(
          403,
          "REPORT_FORBIDDEN",
          "Permisos insuficientes.",
        );
      }

      const branches = await authorizedBranches(
        tx,
        actor,
        query,
      );

      let dates:
        { gte: Date; lt: Date } | undefined;

      let period:
        { desde: string; hasta: string } | null = null;

      if (kind !== "existencias") {
        try {
          period = resolveReportPeriod(
            query,
            company.zona_horaria,
          );
        } catch {
          throw new ReportError(
            400,
            "REPORT_INVALID_PERIOD",
            "Periodo invalido o superior a 366 dias.",
          );
        }

        dates = await resolveBounds(
          tx,
          period.desde,
          period.hasta,
          company.zona_horaria,
        );
      }

      const skip = exportMode
        ? 0
        : (query.page - 1) * query.limit;

      const take = exportMode
        ? exportLimit
        : query.limit;

      const result = await fetchRows(
        tx,
        actor,
        kind,
        query,
        branches,
        dates,
        skip,
        take,
      );

      if (
        exportMode &&
        result.total > exportLimit
      ) {
        throw new ReportError(
          413,
          "REPORT_EXPORT_LIMIT",
          "La exportacion excede 3000 registros. Ajuste los filtros.",
        );
      }

      return {
        tipo: kind,
        periodo: period
          ? {
              fecha_desde: period.desde,
              fecha_hasta: period.hasta,
              zona_horaria: company.zona_horaria,
            }
          : null,
        moneda: company.moneda,
        sucursal_id:
          query.sucursal_id?.toString() ?? null,
        data: result.items,
        pagination: exportMode
          ? null
          : {
              page: query.page,
              limit: query.limit,
              total: result.total,
              total_pages: Math.ceil(
                result.total / query.limit
              ),
            },
        total_exportacion:
          exportMode ? result.total : null,
      };
    }, {
      isolationLevel:
        Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20000,
    });
  },
};
