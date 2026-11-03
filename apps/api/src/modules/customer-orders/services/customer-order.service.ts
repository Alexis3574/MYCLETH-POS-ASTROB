import { Prisma } from '../../../generated/prisma/client.js';
import { prisma } from '../../../lib/prisma.js';
import { customerOrderErrors, translateCustomerOrderDatabaseError } from '../errors/customer-order.errors.js';
import { customerOrderRepository } from '../repositories/customer-order.repository.js';
import type { CustomerOrderCreate, CustomerOrderDetails, CustomerOrderList, CustomerOrderUpdate } from '../customer-order.schema.js';
import type { CustomerOrderActor, CustomerOrderTx, CustomerOrderAction } from '../types/customer-order.types.js';
import { allowedTransition, destinationState, encodeResponse, lineAmounts, MAX_MONEY } from '../utils/customer-order-values.js';

type PreparedRow = {
  producto_id: bigint; descripcion: string | null; cantidad: string;
  precio_unitario: string; descuento_porcentaje: string; tasa_impuesto: string;
};

async function transaction<T>(work: (tx: CustomerOrderTx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 30000,
    });
  } catch (error: unknown) {
    throw translateCustomerOrderDatabaseError(error);
  }
}

async function verifyActor(tx: CustomerOrderTx, actor: CustomerOrderActor) {
  const user = await tx.usuario.findFirst({
    where: { id: actor.userId, empresa_id: actor.empresaId, activo: true,
      bloqueado: false, empresa: { activo: true } },
    select: { id: true },
  });
  if (!user) throw customerOrderErrors.forbidden();
}

async function verifyBranch(tx: CustomerOrderTx, actor: CustomerOrderActor, id: bigint, active: boolean) {
  const branch = await tx.sucursal.findFirst({
    where: { id, empresa_id: actor.empresaId, ...(active ? { activo: true } : {}) },
    select: { id: true },
  });
  if (!branch) throw customerOrderErrors.notFound();
  const assignment = await tx.usuario_sucursal.findUnique({
    where: { usuario_id_sucursal_id: { usuario_id: actor.userId, sucursal_id: id } },
    select: { usuario_id: true },
  });
  if (!assignment) throw customerOrderErrors.notFound();
}

async function verifyCustomer(tx: CustomerOrderTx, empresaId: bigint, id: bigint) {
  const customer = await tx.cliente.findFirst({
    where: { id, empresa_id: empresaId, activo: true }, select: { id: true },
  });
  if (!customer) throw customerOrderErrors.invalid('Cliente inexistente, inactivo o de otra empresa.');
}

function verifyTotals(rows: PreparedRow[]) {
  let subtotal = new Prisma.Decimal(0);
  let descuento = new Prisma.Decimal(0);
  let impuesto = new Prisma.Decimal(0);
  let total = new Prisma.Decimal(0);
  for (const row of rows) {
    let amounts: ReturnType<typeof lineAmounts>;
    try {
      amounts = lineAmounts(row.cantidad, row.precio_unitario, row.descuento_porcentaje, row.tasa_impuesto);
    } catch (error: unknown) {
      if (error instanceof RangeError) throw customerOrderErrors.invalid('Importes fuera del rango NUMERIC(14,2).');
      throw error;
    }
    subtotal = subtotal.plus(amounts.subtotal);
    descuento = descuento.plus(amounts.descuento);
    impuesto = impuesto.plus(amounts.impuesto);
    total = total.plus(amounts.total);
    if ([subtotal, descuento, impuesto, total].some(v => v.gt(MAX_MONEY))) {
      throw customerOrderErrors.invalid('Totales fuera del rango NUMERIC(14,2).');
    }
  }
}

async function prepareDetails(tx: CustomerOrderTx, actor: CustomerOrderActor, details: CustomerOrderDetails): Promise<PreparedRow[]> {
  const result: PreparedRow[] = [];
  for (const detail of details) {
    const product = await tx.producto.findFirst({
      where: { id: detail.producto_id, empresa_id: actor.empresaId, activo: true },
      include: {
        unidad_medida: { select: { activo: true, permite_decimales: true } },
        producto_impuesto: { include: { impuesto: { select: { empresa_id: true, activo: true, tasa: true } } } },
      },
    });
    if (!product || !product.unidad_medida.activo) {
      throw customerOrderErrors.invalid('Producto o unidad inactivos, inexistentes o de otra empresa.');
    }
    if (!product.unidad_medida.permite_decimales && !new Prisma.Decimal(detail.cantidad).isInteger()) {
      throw customerOrderErrors.invalid(`El producto ${product.sku} requiere cantidades enteras.`);
    }
    // Sales/Ecommerce currently sends integer stock adjustments; reject unsupported fractional inventory quantities.
    if (product.controla_inventario && !new Prisma.Decimal(detail.cantidad).isInteger()) {
      throw customerOrderErrors.invalid(`El producto ${product.sku} no admite cantidad fraccionaria en la sincronización Ecommerce actual.`);
    }
    let tax = new Prisma.Decimal(0);
    for (const link of product.producto_impuesto) {
      if (link.impuesto.empresa_id !== actor.empresaId) {
        throw customerOrderErrors.invalid('Impuesto asociado a otra empresa.');
      }
      if (link.impuesto.activo) tax = tax.plus(link.impuesto.tasa);
    }
    if (tax.gt(100)) throw customerOrderErrors.invalid('Impuestos acumulados superiores a 100%.');
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

async function createDetails(tx: CustomerOrderTx, id: bigint, rows: PreparedRow[]) {
  for (const row of rows) {
    await tx.pedido_cliente_detalle.create({ data: { ...row, pedido_cliente_id: id } });
  }
}

async function audit(tx: CustomerOrderTx, actor: CustomerOrderActor, id: bigint, action: string) {
  await tx.auditoria.create({ data: {
    usuario_id: actor.userId, tabla: 'pedido_cliente', registro_id: id,
    accion: action === 'CREAR' ? 'INSERT' : 'UPDATE',
    datos_nuevos: { modulo: 'PEDIDOS', accion: action },
  } });
}

async function snapshot(tx: CustomerOrderTx, actor: CustomerOrderActor, id: bigint) {
  const order = await customerOrderRepository.find(tx, actor.empresaId, id);
  if (!order) throw customerOrderErrors.notFound();
  return encodeResponse(order);
}

async function lockOrder(tx: CustomerOrderTx, actor: CustomerOrderActor, id: bigint) {
  await verifyActor(tx, actor);
  if (!await customerOrderRepository.lock(tx, actor.empresaId, id)) throw customerOrderErrors.notFound();
  const order = await customerOrderRepository.find(tx, actor.empresaId, id);
  if (!order) throw customerOrderErrors.notFound();
  await verifyBranch(tx, actor, order.sucursal_id, false);
  return order;
}

const calendarDate = (value: string | null | undefined): Date | null =>
  value ? new Date(`${value}T00:00:00.000Z`) : null;

export const customerOrderService = {
  list(actor: CustomerOrderActor, query: CustomerOrderList) {
    return transaction(async tx => {
      await verifyActor(tx, actor);
      const assigned = await tx.usuario_sucursal.findMany({
        where: { usuario_id: actor.userId, sucursal: { empresa_id: actor.empresaId } },
        select: { sucursal_id: true },
      });
      const branches = assigned.map(row => row.sucursal_id);
      if (query.sucursal_id !== undefined && !branches.includes(query.sucursal_id)) throw customerOrderErrors.notFound();
      return encodeResponse(await customerOrderRepository.list(tx, actor.empresaId, branches, query));
    });
  },
  get(actor: CustomerOrderActor, id: bigint) {
    return transaction(async tx => {
      await verifyActor(tx, actor);
      const order = await customerOrderRepository.find(tx, actor.empresaId, id);
      if (!order) throw customerOrderErrors.notFound();
      await verifyBranch(tx, actor, order.sucursal_id, false);
      return encodeResponse(order);
    });
  },
  create(actor: CustomerOrderActor, input: CustomerOrderCreate) {
    return transaction(async tx => {
      await verifyActor(tx, actor);
      await verifyBranch(tx, actor, input.sucursal_id, true);
      await verifyCustomer(tx, actor.empresaId, input.cliente_id);
      const details = await prepareDetails(tx, actor, input.detalles);
      const created = await tx.pedido_cliente.create({ data: {
        empresa_id: actor.empresaId, sucursal_id: input.sucursal_id,
        cliente_id: input.cliente_id, usuario_id: actor.userId, folio: input.folio,
        referencia_cliente: input.referencia_cliente ?? null,
        fecha_entrega: calendarDate(input.fecha_entrega), observaciones: input.observaciones ?? null,
        estado: 'PENDIENTE',
      } });
      await createDetails(tx, created.id, details);
      await audit(tx, actor, created.id, 'CREAR');
      return snapshot(tx, actor, created.id);
    });
  },
  update(actor: CustomerOrderActor, id: bigint, input: CustomerOrderUpdate) {
    return transaction(async tx => {
      const order = await lockOrder(tx, actor, id);
      if (order.estado !== 'PENDIENTE') throw customerOrderErrors.conflict('Solo se editan pedidos PENDIENTE.');
      await verifyBranch(tx, actor, order.sucursal_id, true);
      if (input.cliente_id !== undefined) await verifyCustomer(tx, actor.empresaId, input.cliente_id);
      const details = input.detalles !== undefined ? await prepareDetails(tx, actor, input.detalles) : null;
      await tx.pedido_cliente.update({ where: { id }, data: {
        ...(input.cliente_id !== undefined ? { cliente_id: input.cliente_id } : {}),
        ...(input.referencia_cliente !== undefined ? { referencia_cliente: input.referencia_cliente } : {}),
        ...(input.fecha_entrega !== undefined ? { fecha_entrega: calendarDate(input.fecha_entrega) } : {}),
        ...(input.observaciones !== undefined ? { observaciones: input.observaciones } : {}),
      } });
      if (details !== null) {
        await tx.pedido_cliente_detalle.deleteMany({ where: { pedido_cliente_id: id } });
        await createDetails(tx, id, details);
      }
      await audit(tx, actor, id, 'ACTUALIZAR');
      return snapshot(tx, actor, id);
    });
  },
  changeState(actor: CustomerOrderActor, id: bigint, action: CustomerOrderAction) {
    return transaction(async tx => {
      const order = await lockOrder(tx, actor, id);
      if (!allowedTransition(order.estado, action)) throw customerOrderErrors.conflict('Transición de pedido no permitida.');
      if (action !== 'cancel') {
        await verifyBranch(tx, actor, order.sucursal_id, true);
        if (!order.pedido_cliente_detalle.length) throw customerOrderErrors.invalid('Pedido sin partidas.');
        if (action === 'confirm') await verifyCustomer(tx, actor.empresaId, order.cliente_id);
      }
      // Do not cancel orders that already have *any* linked sale (even cancelled sales).
      if (action === 'cancel') {
        const sale = await tx.venta.findFirst({ where: { pedido_cliente_id: id }, select: { id: true } });
        if (sale) throw customerOrderErrors.conflict('El pedido tiene una venta asociada.');
      }
      await tx.pedido_cliente.update({ where: { id }, data: { estado: destinationState[action] } });
      await audit(tx, actor, id, destinationState[action]);
      return snapshot(tx, actor, id);
    });
  },
};
