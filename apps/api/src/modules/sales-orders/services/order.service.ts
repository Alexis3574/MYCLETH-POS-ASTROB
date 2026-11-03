import { Prisma } from '../../../generated/prisma/client.js';
import { prisma } from '../../../lib/prisma.js';
import { orderErrors, translateOrderDatabaseError } from '../errors/order.errors.js';
import { orderRepository } from '../repositories/order.repository.js';
import type { OrderCreate, OrderDetails, OrderFromQuote, OrderList, OrderUpdate } from '../order.schema.js';
import type { OrderAction, OrderActor, OrderTx } from '../types/order.types.js';
import { allowedTransition, destinationState, encodeResponse, lineAmounts, MAX_MONEY } from '../utils/order-values.js';

type PreparedRow = {
  producto_id: bigint; descripcion: string | null; cantidad: string;
  precio_unitario: string; descuento_porcentaje: string; tasa_impuesto: string;
};

async function transaction<T>(work: (tx: OrderTx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 30000 });
  } catch (error: unknown) {
    throw translateOrderDatabaseError(error);
  }
}

async function verifyActor(tx: OrderTx, actor: OrderActor) {
  const user = await tx.usuario.findFirst({
    where: { id: actor.userId, empresa_id: actor.empresaId, activo: true,
      bloqueado: false, empresa: { activo: true } },
    select: { id: true },
  });
  if (!user) throw orderErrors.forbidden();
}

async function verifyBranch(tx: OrderTx, actor: OrderActor, id: bigint, mustBeActive: boolean) {
  const branch = await tx.sucursal.findFirst({
    where: { id, empresa_id: actor.empresaId, ...(mustBeActive ? { activo: true } : {}) },
    select: { id: true },
  });
  if (!branch) throw orderErrors.notFound();
  const assignment = await tx.usuario_sucursal.findUnique({
    where: { usuario_id_sucursal_id: { usuario_id: actor.userId, sucursal_id: id } },
    select: { usuario_id: true },
  });
  if (!assignment) throw orderErrors.notFound();
}

async function verifyCustomer(tx: OrderTx, empresaId: bigint, id: bigint | null) {
  if (id === null) return;
  const customer = await tx.cliente.findFirst({
    where: { id, empresa_id: empresaId, activo: true }, select: { id: true },
  });
  if (!customer) throw orderErrors.invalid('Cliente inactivo, inexistente o de otra empresa.');
}

function verifyTotals(rows: PreparedRow[]) {
  let total = new Prisma.Decimal(0);
  for (const row of rows) {
    let amounts: ReturnType<typeof lineAmounts>;
    try {
      amounts = lineAmounts(row.cantidad, row.precio_unitario, row.descuento_porcentaje, row.tasa_impuesto);
    } catch (error: unknown) {
      if (error instanceof RangeError) throw orderErrors.invalid('Importes fuera del rango NUMERIC(14,2).');
      throw error;
    }
    total = total.plus(amounts.total);
    if (total.gt(MAX_MONEY)) throw orderErrors.invalid('Importes fuera del rango NUMERIC(14,2).');
  }
}

async function prepareDetails(tx: OrderTx, actor: OrderActor, details: OrderDetails): Promise<PreparedRow[]> {
  const result: PreparedRow[] = [];
  for (const detail of details) {
    const product = await tx.producto.findFirst({
      where: { id: detail.producto_id, empresa_id: actor.empresaId, activo: true },
      include: {
        unidad_medida: { select: { activo: true, permite_decimales: true } },
        producto_impuesto: { include: { impuesto: { select: { empresa_id: true, activo: true, tasa: true } } } },
      },
    });
    if (!product || !product.unidad_medida.activo) throw orderErrors.invalid('Producto inexistente, inactivo o de otra empresa.');
    if (!product.unidad_medida.permite_decimales && !new Prisma.Decimal(detail.cantidad).isInteger()) {
      throw orderErrors.invalid(`El producto ${product.sku} requiere cantidades enteras.`);
    }
    if (product.controla_inventario && !new Prisma.Decimal(detail.cantidad).isInteger()) {
      throw orderErrors.invalid(`El producto ${product.sku} no admite conversión a venta con cantidad fraccionaria por la sincronización Ecommerce actual.`);
    }
    let tax = new Prisma.Decimal(0);
    for (const link of product.producto_impuesto) {
      if (link.impuesto.empresa_id !== actor.empresaId) throw orderErrors.invalid('Impuestos de otra empresa.');
      if (link.impuesto.activo) tax = tax.plus(link.impuesto.tasa);
    }
    if (tax.gt(100)) throw orderErrors.invalid('Tasa de impuesto acumulada superior a 100%.');
    result.push({
      producto_id: product.id,
      descripcion: detail.descripcion ?? product.nombre,
      cantidad: detail.cantidad,
      precio_unitario: product.precio_venta.toFixed(4),
      descuento_porcentaje: detail.descuento_porcentaje,
      tasa_impuesto: tax.toFixed(4),
    });
  }
  verifyTotals(result);
  return result;
}

async function createDetails(tx: OrderTx, orderId: bigint, details: PreparedRow[]) {
  for (const row of details) {
    await tx.orden_venta_detalle.create({ data: { ...row, orden_venta_id: orderId } });
  }
}

async function audit(tx: OrderTx, actor: OrderActor, orderId: bigint, action: string) {
  await tx.auditoria.create({ data: {
    usuario_id: actor.userId,
    tabla: 'orden_venta',
    registro_id: orderId,
    accion: action === 'CREAR' ? 'INSERT' : 'UPDATE',
    datos_nuevos: { modulo: 'ORDENES', accion: action },
  } });
}

async function snapshot(tx: OrderTx, actor: OrderActor, id: bigint) {
  const order = await orderRepository.find(tx, actor.empresaId, id);
  if (!order) throw orderErrors.notFound();
  return encodeResponse(order);
}

async function lockOrder(tx: OrderTx, actor: OrderActor, id: bigint) {
  await verifyActor(tx, actor);
  if (!await orderRepository.lock(tx, actor.empresaId, id)) throw orderErrors.notFound();
  const order = await orderRepository.find(tx, actor.empresaId, id);
  if (!order) throw orderErrors.notFound();
  await verifyBranch(tx, actor, order.sucursal_id, false);
  return order;
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function todayInTimeZone(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const field = (type: string) => parts.find(part => part.type === type)?.value ?? '';
    return `${field('year')}-${field('month')}-${field('day')}`;
  } catch {
    throw orderErrors.invalid('Zona horaria de empresa inválida.');
  }
}

export const orderService = {
  list(actor: OrderActor, query: OrderList) {
    return transaction(async tx => {
      await verifyActor(tx, actor);
      const assigned = await tx.usuario_sucursal.findMany({
        where: { usuario_id: actor.userId, sucursal: { empresa_id: actor.empresaId } },
        select: { sucursal_id: true },
      });
      const branches = assigned.map(a => a.sucursal_id);
      if (query.sucursal_id !== undefined && !branches.includes(query.sucursal_id)) throw orderErrors.notFound();
      return encodeResponse(await orderRepository.list(tx, actor.empresaId, branches, query));
    });
  },
  get(actor: OrderActor, id: bigint) {
    return transaction(async tx => {
      await verifyActor(tx, actor);
      const order = await orderRepository.find(tx, actor.empresaId, id);
      if (!order) throw orderErrors.notFound();
      await verifyBranch(tx, actor, order.sucursal_id, false);
      return encodeResponse(order);
    });
  },
  create(actor: OrderActor, input: OrderCreate) {
    return transaction(async tx => {
      await verifyActor(tx, actor);
      await verifyBranch(tx, actor, input.sucursal_id, true);
      await verifyCustomer(tx, actor.empresaId, input.cliente_id ?? null);
      const details = await prepareDetails(tx, actor, input.detalles);
      const order = await tx.orden_venta.create({ data: {
        empresa_id: actor.empresaId, sucursal_id: input.sucursal_id,
        cliente_id: input.cliente_id ?? null, usuario_id: actor.userId,
        folio: input.folio, fecha_compromiso: parseOptionalDate(input.fecha_compromiso),
        observaciones: input.observaciones ?? null, estado: 'PENDIENTE',
      } });
      await createDetails(tx, order.id, details);
      await audit(tx, actor, order.id, 'CREAR');
      return snapshot(tx, actor, order.id);
    });
  },
  update(actor: OrderActor, id: bigint, input: OrderUpdate) {
    return transaction(async tx => {
      const order = await lockOrder(tx, actor, id);
      if (order.estado !== 'PENDIENTE') throw orderErrors.conflict('Solo pueden editarse órdenes PENDIENTE.');
      await verifyBranch(tx, actor, order.sucursal_id, true);
      if (order.cotizacion_id !== null && (input.detalles !== undefined || input.cliente_id !== undefined)) {
        throw orderErrors.conflict('Las órdenes de cotización conservan cliente y partidas originales.');
      }
      if (input.cliente_id !== undefined) await verifyCustomer(tx, actor.empresaId, input.cliente_id);
      const details = input.detalles === undefined ? null : await prepareDetails(tx, actor, input.detalles);
      await tx.orden_venta.update({ where: { id }, data: {
        ...(input.cliente_id !== undefined ? { cliente_id: input.cliente_id } : {}),
        ...(input.fecha_compromiso !== undefined ? { fecha_compromiso: parseOptionalDate(input.fecha_compromiso) } : {}),
        ...(input.observaciones !== undefined ? { observaciones: input.observaciones } : {}),
      } });
      if (details !== null) {
        await tx.orden_venta_detalle.deleteMany({ where: { orden_venta_id: id } });
        await createDetails(tx, id, details);
      }
      await audit(tx, actor, id, 'ACTUALIZAR');
      return snapshot(tx, actor, id);
    });
  },
  changeState(actor: OrderActor, id: bigint, action: OrderAction) {
    return transaction(async tx => {
      const order = await lockOrder(tx, actor, id);
      if (!allowedTransition(order.estado, action)) throw orderErrors.conflict('Transición de estado no permitida.');
      if (action !== 'cancel') {
        await verifyBranch(tx, actor, order.sucursal_id, true);
        if (!order.orden_venta_detalle.length) throw orderErrors.invalid('Orden sin productos.');
      }
      if (action === 'cancel') {
        const linkedSale = await tx.venta.findFirst({ where: { orden_venta_id: id }, select: { id: true } });
        if (linkedSale) throw orderErrors.conflict('No se cancela una orden con venta asociada.');
      }
      await tx.orden_venta.update({ where: { id }, data: { estado: destinationState[action] } });
      await audit(tx, actor, id, destinationState[action]);
      return snapshot(tx, actor, id);
    });
  },
  fromQuote(actor: OrderActor, quoteId: bigint, input: OrderFromQuote) {
    return transaction(async tx => {
      await verifyActor(tx, actor);
      const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM pos.cotizacion WHERE id = ${quoteId} AND empresa_id = ${actor.empresaId} FOR UPDATE
      `;
      if (locked.length !== 1) throw orderErrors.notFound();
      const quote = await tx.cotizacion.findFirst({
        where: { id: quoteId, empresa_id: actor.empresaId },
        include: { cotizacion_detalle: { orderBy: { id: 'asc' } } },
      });
      if (!quote) throw orderErrors.notFound();
      await verifyBranch(tx, actor, quote.sucursal_id, true);
      if (quote.estado === 'CONVERTIDA') {
        const existing = await tx.orden_venta.findFirst({ where: { cotizacion_id: quoteId, empresa_id: actor.empresaId } });
        if (existing && existing.folio === input.folio) return snapshot(tx, actor, existing.id);
        throw orderErrors.conflict('Cotización ya convertida con otro folio o destino.');
      }
      if (quote.estado !== 'ACEPTADA') throw orderErrors.conflict('Solo se convierten cotizaciones ACEPTADA.');
      if (quote.valida_hasta !== null) {
        const company = await tx.empresa.findUnique({ where: { id: actor.empresaId }, select: { zona_horaria: true } });
        if (!company) throw orderErrors.notFound();
        if (quote.valida_hasta.toISOString().slice(0, 10) < todayInTimeZone(company.zona_horaria)) {
          throw orderErrors.conflict('Cotización vencida.');
        }
      }
      if (quote.cotizacion_detalle.length === 0) throw orderErrors.invalid('Cotización sin partidas.');
      await verifyCustomer(tx, actor.empresaId, quote.cliente_id);
      const rows: PreparedRow[] = [];
      for (const detail of quote.cotizacion_detalle) {
        const product = await tx.producto.findFirst({
          where: { id: detail.producto_id, empresa_id: actor.empresaId, activo: true },
          select: { id: true, sku: true, controla_inventario: true, unidad_medida: { select: { activo: true, permite_decimales: true } } },
        });
        if (!product || !product.unidad_medida.activo) throw orderErrors.invalid('Producto de cotización inactivo o de otra empresa.');
        if (!product.unidad_medida.permite_decimales && !detail.cantidad.isInteger()) throw orderErrors.invalid('Unidad incompatible con cantidad fraccionaria.');
        if (product.controla_inventario && !detail.cantidad.isInteger()) throw orderErrors.invalid('Cantidad fraccionaria incompatible con Ecommerce.');
        rows.push({
          producto_id: detail.producto_id, descripcion: detail.descripcion,
          cantidad: detail.cantidad.toFixed(3), precio_unitario: detail.precio_unitario.toFixed(4),
          descuento_porcentaje: detail.descuento_porcentaje.toFixed(4), tasa_impuesto: detail.tasa_impuesto.toFixed(4),
        });
      }
      verifyTotals(rows);
      const order = await tx.orden_venta.create({ data: {
        empresa_id: actor.empresaId, sucursal_id: quote.sucursal_id, usuario_id: actor.userId,
        cliente_id: quote.cliente_id, cotizacion_id: quoteId, folio: input.folio,
        fecha_compromiso: parseOptionalDate(input.fecha_compromiso),
        observaciones: input.observaciones ?? quote.observaciones,
        estado: 'PENDIENTE',
      } });
      await createDetails(tx, order.id, rows);
      await tx.cotizacion.update({ where: { id: quoteId }, data: { estado: 'CONVERTIDA' } });
      await audit(tx, actor, order.id, 'DESDE_COTIZACION');
      await tx.auditoria.create({ data: {
        usuario_id: actor.userId, tabla: 'cotizacion', registro_id: quoteId,
        accion: 'UPDATE', datos_nuevos: { modulo: 'COTIZACIONES', accion: 'CONVERTIDA_A_ORDEN' },
      } });
      return snapshot(tx, actor, order.id);
    });
  },
};
