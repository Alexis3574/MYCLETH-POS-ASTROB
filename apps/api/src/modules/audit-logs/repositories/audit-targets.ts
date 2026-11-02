import { Prisma } from "../../../generated/prisma/client.js";

/*
 * Cada origen debe devolver:
 * empresa_id, sucursal_id, sucursal_destino_id, solo_admin.
 *
 * No se permite utilizar empresa_id del actor como
 * unica prueba de propiedad del documento.
 *
 * Entidades eliminadas o sin relacion verificable
 * no generan filas y permanecen ocultas.
 */
const targets: Prisma.Sql[] = [
  Prisma.sql`
    SELECT v.empresa_id, v.sucursal_id,
           NULL::bigint AS sucursal_destino_id,
           FALSE AS solo_admin
    FROM pos.venta v
    JOIN pos.sucursal s
      ON s.id = v.sucursal_id
     AND s.empresa_id = v.empresa_id
    WHERE a.tabla = 'venta'
      AND v.id = a.registro_id
  `,

  Prisma.sql`
    SELECT v.empresa_id, v.sucursal_id,
           NULL::bigint, FALSE
    FROM pos.devolucion_venta d
    JOIN pos.venta v ON v.id = d.venta_id
    JOIN pos.sucursal s
      ON s.id = v.sucursal_id
     AND s.empresa_id = v.empresa_id
    WHERE a.tabla = 'devolucion_venta'
      AND d.id = a.registro_id
  `,

  Prisma.sql`
    SELECT c.empresa_id, c.sucursal_id,
           NULL::bigint, FALSE
    FROM pos.compra c
    JOIN pos.sucursal s
      ON s.id = c.sucursal_id
     AND s.empresa_id = c.empresa_id
    WHERE a.tabla = 'compra'
      AND c.id = a.registro_id
  `,

  Prisma.sql`
    SELECT c.empresa_id, c.sucursal_id,
           NULL::bigint, FALSE
    FROM pos.cotizacion c
    JOIN pos.sucursal s
      ON s.id = c.sucursal_id
     AND s.empresa_id = c.empresa_id
    WHERE a.tabla = 'cotizacion'
      AND c.id = a.registro_id
  `,

  Prisma.sql`
    SELECT o.empresa_id, o.sucursal_id,
           NULL::bigint, FALSE
    FROM pos.orden_venta o
    JOIN pos.sucursal s
      ON s.id = o.sucursal_id
     AND s.empresa_id = o.empresa_id
    WHERE a.tabla = 'orden_venta'
      AND o.id = a.registro_id
  `,

  Prisma.sql`
    SELECT p.empresa_id, p.sucursal_id,
           NULL::bigint, FALSE
    FROM pos.pedido_cliente p
    JOIN pos.sucursal s
      ON s.id = p.sucursal_id
     AND s.empresa_id = p.empresa_id
    WHERE a.tabla = 'pedido_cliente'
      AND p.id = a.registro_id
  `,

  Prisma.sql`
    SELECT j.empresa_id, s.id,
           NULL::bigint, FALSE
    FROM pos.ajuste_inventario j
    JOIN pos.almacen al
      ON al.id = j.almacen_id
    JOIN pos.sucursal s
      ON s.id = al.sucursal_id
     AND s.empresa_id = j.empresa_id
    JOIN pos.producto p
      ON p.id = j.producto_id
     AND p.empresa_id = j.empresa_id
    WHERE a.tabla = 'ajuste_inventario'
      AND j.id = a.registro_id
  `,

  Prisma.sql`
    SELECT t.empresa_id, so.id, sd.id,
           FALSE
    FROM pos.transferencia_almacen t
    JOIN pos.almacen ao
      ON ao.id = t.almacen_origen_id
    JOIN pos.almacen ad
      ON ad.id = t.almacen_destino_id
    JOIN pos.sucursal so
      ON so.id = ao.sucursal_id
     AND so.empresa_id = t.empresa_id
    JOIN pos.sucursal sd
      ON sd.id = ad.sucursal_id
     AND sd.empresa_id = t.empresa_id
    WHERE a.tabla = 'transferencia_almacen'
      AND t.id = a.registro_id
  `,

  Prisma.sql`
    SELECT c.empresa_id, NULL::bigint,
           NULL::bigint, TRUE
    FROM pos.cliente c
    WHERE a.tabla = 'cliente'
      AND c.id = a.registro_id
  `,

  Prisma.sql`
    SELECT c.empresa_id, NULL::bigint,
           NULL::bigint, TRUE
    FROM pos.cliente_direccion d
    JOIN pos.cliente c
      ON c.id = d.cliente_id
    WHERE a.tabla = 'cliente_direccion'
      AND d.id = a.registro_id
  `,

  Prisma.sql`
    SELECT p.empresa_id, NULL::bigint,
           NULL::bigint, TRUE
    FROM pos.proveedor p
    WHERE a.tabla = 'proveedor'
      AND p.id = a.registro_id
  `,

  Prisma.sql`
    SELECT p.empresa_id, NULL::bigint,
           NULL::bigint, TRUE
    FROM pos.proveedor_direccion d
    JOIN pos.proveedor p
      ON p.id = d.proveedor_id
    WHERE a.tabla = 'proveedor_direccion'
      AND d.id = a.registro_id
  `,

  Prisma.sql`
    SELECT e.id, NULL::bigint,
           NULL::bigint, TRUE
    FROM pos.empresa e
    WHERE a.tabla = 'empresa'
      AND e.id = a.registro_id
  `,

  Prisma.sql`
    SELECT s.empresa_id, s.id,
           NULL::bigint, TRUE
    FROM pos.sucursal s
    WHERE a.tabla = 'sucursal'
      AND s.id = a.registro_id
  `,

  Prisma.sql`
    SELECT s.empresa_id, s.id,
           NULL::bigint, TRUE
    FROM pos.almacen al
    JOIN pos.sucursal s
      ON s.id = al.sucursal_id
    WHERE a.tabla = 'almacen'
      AND al.id = a.registro_id
  `,

  Prisma.sql`
    SELECT s.empresa_id, s.id,
           NULL::bigint, TRUE
    FROM pos.sucursal s
    WHERE a.tabla = 'usuario_sucursal'
      AND s.id = a.registro_id
  `,

  Prisma.sql`
    SELECT s.empresa_id, s.id,
           NULL::bigint, FALSE
    FROM pos.caja c
    JOIN pos.sucursal s
      ON s.id = c.sucursal_id
    WHERE a.tabla = 'caja'
      AND c.id = a.registro_id
  `,

  Prisma.sql`
    SELECT su.empresa_id, su.id,
           NULL::bigint, FALSE
    FROM pos.sesion_caja sc
    JOIN pos.caja c
      ON c.id = sc.caja_id
    JOIN pos.sucursal su
      ON su.id = c.sucursal_id
    WHERE a.tabla = 'sesion_caja'
      AND sc.id = a.registro_id
  `,

  Prisma.sql`
    SELECT su.empresa_id, su.id,
           NULL::bigint, FALSE
    FROM pos.movimiento_caja m
    JOIN pos.sesion_caja sc
      ON sc.id = m.sesion_caja_id
    JOIN pos.caja c
      ON c.id = sc.caja_id
    JOIN pos.sucursal su
      ON su.id = c.sucursal_id
    WHERE a.tabla = 'movimiento_caja'
      AND m.id = a.registro_id
  `,

  Prisma.sql`
    SELECT s.empresa_id, s.id,
           NULL::bigint, FALSE
    FROM pos.sincronizacion_ecommerce_inventario e
    JOIN pos.movimiento_inventario m
      ON m.id = e.movimiento_inventario_id
    JOIN pos.almacen al
      ON al.id = m.almacen_id
    JOIN pos.sucursal s
      ON s.id = al.sucursal_id
    JOIN pos.producto p
      ON p.id = m.producto_id
     AND p.empresa_id = s.empresa_id
    WHERE a.tabla = 'sincronizacion_ecommerce_inventario'
      AND e.id = a.registro_id
  `
];

export function auditSourceFor(
  auditRelation: Prisma.Sql
): Prisma.Sql {
  return Prisma.sql`
    FROM ${auditRelation} a
    INNER JOIN pos.usuario u
      ON u.id = a.usuario_id
    INNER JOIN LATERAL (
      ${Prisma.join(targets, " UNION ALL ")}
    ) target ON TRUE
  `;
}

export const auditSource = auditSourceFor(
  Prisma.sql`pos.auditoria`
);
