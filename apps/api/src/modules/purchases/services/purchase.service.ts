import { Prisma } from '../../../generated/prisma/client.js';
import { prisma } from '../../../lib/prisma.js';
import { inventorySyncRepository } from '../../inventory-sync/inventory-sync.repository.js';
import { purchaseError, purchaseRetryable, translatePurchaseError } from '../errors/purchase.errors.js';
import { purchaseRepository } from '../repositories/purchase.repository.js';
import { purchaseOperationRepository as operations } from '../repositories/purchase-operation.repository.js';
import { validatePurchaseActor, validatePurchaseContext, validatePurchaseCurrentContext } from '../validators/purchase-context.validator.js';
import { hashPurchaseRequest, purchaseOperationId, safePurchaseJson } from '../utils/purchase-values.js';
import type { PurchaseAction, PurchaseActor, PurchaseCreateInput, PurchasePaymentInput, PurchaseTx } from '../types/purchase.types.js';

type PurchaseResponse = unknown;

async function transact<T>(run: (tx: PurchaseTx) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(run, { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 30000 });
    } catch (error) {
      if (purchaseRetryable(error) && attempt < 2) continue;
      throw translatePurchaseError(error);
    }
  }
  throw new Error('No se pudo completar la operación.');
}

async function snapshot(tx: PurchaseTx, actor: PurchaseActor, purchaseId: bigint): Promise<PurchaseResponse> {
  const row = await purchaseRepository.get(tx, actor.empresaId, purchaseId);
  if (!row) throw purchaseError.notFound();
  await validateBranchAccess(tx, actor, row.sucursal_id);
  const paid = row.compra_pago.reduce((sum, payment) => sum.plus(payment.monto), new Prisma.Decimal(0));
  const balance = row.total.minus(paid);
  if (balance.isNegative()) throw purchaseError.conflict('PURCHASE_PAYMENT_EXCEEDED', 'Los pagos exceden el total de la compra.');
  return safePurchaseJson({ ...row, resumen_financiero: {
    total_pagado: paid.toFixed(2), saldo_pendiente: balance.toFixed(2),
  } });
}

async function replayOrNull(tx: PurchaseTx, actor: PurchaseActor, action: PurchaseAction,
  key: string, hash: string): Promise<{ replayed: true; data: PurchaseResponse } | null> {
  await validatePurchaseActor(tx, actor);
  const previous = await operations.replay(tx, actor, action, key, hash);
  return previous === null ? null : { replayed: true, data: previous };
}

async function completeOperation(tx: PurchaseTx, actor: PurchaseActor, action: PurchaseAction,
  id: bigint, key: string, hash: string, before: unknown = null) {
  const response = await snapshot(tx, actor, id);
  await operations.persist(tx, actor, action, id, key, hash, response);
  await operations.audit(tx, actor, id, action, { clave_idempotencia: key, anterior: before, estado: (response as { estado: string }).estado });
  return { replayed: false, data: response };
}

async function lockAndGet(tx: PurchaseTx, actor: PurchaseActor, id: bigint) {
  if (!await purchaseRepository.lock(tx, actor.empresaId, id)) throw purchaseError.notFound();
  const record = await purchaseRepository.get(tx, actor.empresaId, id);
  if (!record) throw purchaseError.notFound();
  return record;
}

async function validateBranchAccess(tx: PurchaseTx, actor: PurchaseActor, branchId: bigint) {
  const branch = await tx.sucursal.findFirst({ where: { id: branchId, empresa_id: actor.empresaId }, select: { id: true } });
  if (!branch) throw purchaseError.notFound();
  const assignment = await tx.usuario_sucursal.findUnique({
    where: { usuario_id_sucursal_id: { usuario_id: actor.userId, sucursal_id: branchId } },
  });
  if (!assignment) throw purchaseError.forbidden();
}

async function getMovementRows(tx: PurchaseTx, id: bigint, documentType: 'COMPRA' | 'CANCELACION_COMPRA') {
  return tx.movimiento_inventario.findMany({
    where: { documento_tipo: documentType, documento_id: id },
    orderBy: [{ documento_detalle_id: 'asc' }, { id: 'asc' }],
  });
}

async function enqueueStockEvents(tx: PurchaseTx, actor: PurchaseActor,
  row: Awaited<ReturnType<typeof lockAndGet>>, action: 'stock-in' | 'stock-out') {
  const source = action === 'stock-in' ? 'COMPRA' : 'CANCELACION_COMPRA';
  const movements = await getMovementRows(tx, row.id, source);
  const expected = row.compra_detalle.filter((item) => item.producto.controla_inventario);
  if (movements.length !== expected.length) throw new Error('PURCHASE_MOVEMENT_INVARIANT: faltan o sobran movimientos de inventario.');
  const used = new Set<string>();
  for (const item of expected) {
    const match = movements.filter((movement) =>
      movement.documento_detalle_id === item.id && movement.producto_id === item.producto_id &&
      movement.almacen_id === row.almacen_id && movement.tipo === (action === 'stock-in' ? 'ENTRADA' : 'SALIDA') &&
      movement.cantidad.equals(item.cantidad) && movement.usuario_id === actor.userId);
    if (match.length !== 1 || used.has(item.id.toString())) throw new Error('PURCHASE_MOVEMENT_INVARIANT: movimiento no coincide con detalle.');
    used.add(item.id.toString());
    const quantity = item.cantidad.toNumber();
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2147483647) {
      throw purchaseError.invalid('Cantidad incompatible con el contrato Ecommerce.');
    }
    const barcode = item.producto.codigo_barras;
    if (!barcode) throw purchaseError.invalid('Falta código de barras para sincronización Ecommerce.');
    await inventorySyncRepository.createPending({
      movimientoInventarioId: match[0]!.id,
      operationId: purchaseOperationId(actor.empresaId, row.id, item.id, action),
      codigoBarras: barcode,
      sku: item.producto.sku,
      adjustment: action === 'stock-in' ? quantity : -quantity,
    }, tx);
  }
  return movements.length;
}

async function receiveInTx(tx: PurchaseTx, actor: PurchaseActor, id: bigint, key: string) {
  const hash = hashPurchaseRequest(actor.userId, 'RECIBIR', id, {});
  const previous = await replayOrNull(tx, actor, 'RECIBIR', key, hash);
  if (previous) return previous;
  const row = await lockAndGet(tx, actor, id);
  if (row.estado !== 'BORRADOR') throw purchaseError.conflict('PURCHASE_INVALID_STATE', 'Solo pueden recibirse compras en BORRADOR.');
  await validatePurchaseCurrentContext(tx, actor, row);
  if (await getMovementRows(tx, id, 'COMPRA').then((m) => m.length) !== 0) {
    throw purchaseError.conflict('PURCHASE_MOVEMENTS_EXIST', 'La compra ya posee movimientos de recepción.');
  }
  // El procedimiento y el trigger existente controlan los movimientos y el costo promedio.
  await tx.$executeRawUnsafe("SET LOCAL search_path TO pos, pg_catalog");
  await tx.$executeRaw`CALL pos.sp_recibir_compra(${id}::bigint, ${actor.userId}::bigint)`;
  const received = await purchaseRepository.get(tx, actor.empresaId, id);
  if (!received || received.estado !== 'RECIBIDA') throw new Error('PURCHASE_STATE_INVARIANT: no se recibió la compra.');
  await enqueueStockEvents(tx, actor, received, 'stock-in');
  return completeOperation(tx, actor, 'RECIBIR', id, key, hash, { estado: row.estado });
}

async function cancelInTx(tx: PurchaseTx, actor: PurchaseActor, id: bigint, key: string, motivo: string) {
  const hash = hashPurchaseRequest(actor.userId, 'CANCELAR', id, { motivo });
  const previous = await replayOrNull(tx, actor, 'CANCELAR', key, hash);
  if (previous) return previous;
  const row = await lockAndGet(tx, actor, id);
  await validateBranchAccess(tx, actor, row.sucursal_id);
  if (row.estado === 'CANCELADA') throw purchaseError.conflict('PURCHASE_ALREADY_CANCELLED', 'La compra ya está cancelada.');
  if (row.compra_pago.length > 0) throw purchaseError.conflict('PURCHASE_HAS_PAYMENTS', 'No se puede cancelar una compra con pagos registrados sin un flujo de reversión financiera.');
  if (row.estado === 'RECIBIDA') {
    const movements = await getMovementRows(tx, id, 'COMPRA');
    if (movements.length !== row.compra_detalle.filter((item) => item.producto.controla_inventario).length) {
      throw purchaseError.conflict('PURCHASE_MOVEMENTS_MISMATCH', 'No coinciden los movimientos históricos de recepción.');
    }
    if (await getMovementRows(tx, id, 'CANCELACION_COMPRA').then((m) => m.length) !== 0) {
      throw purchaseError.conflict('PURCHASE_CANCEL_MOVEMENTS_EXIST', 'Ya existen movimientos de cancelación.');
    }
  }
  await tx.$executeRawUnsafe("SET LOCAL search_path TO pos, pg_catalog");
  await tx.$executeRaw`CALL pos.sp_cancelar_compra(${id}::bigint, ${actor.userId}::bigint, ${motivo}::text)`;
  const cancelled = await purchaseRepository.get(tx, actor.empresaId, id);
  if (!cancelled || cancelled.estado !== 'CANCELADA') throw new Error('PURCHASE_STATE_INVARIANT: no se canceló la compra.');
  if (row.estado === 'RECIBIDA') await enqueueStockEvents(tx, actor, cancelled, 'stock-out');
  return completeOperation(tx, actor, 'CANCELAR', id, key, hash, { estado: row.estado });
}

async function payInTx(tx: PurchaseTx, actor: PurchaseActor, id: bigint, key: string, input: PurchasePaymentInput) {
  const hash = hashPurchaseRequest(actor.userId, 'PAGAR', id, {
    metodo_pago_id: input.metodo_pago_id.toString(), sesion_caja_id: input.sesion_caja_id?.toString() ?? null,
    monto: input.monto, referencia: input.referencia ?? null,
  });
  const previous = await replayOrNull(tx, actor, 'PAGAR', key, hash);
  if (previous) return previous;
  const row = await lockAndGet(tx, actor, id);
  await validateBranchAccess(tx, actor, row.sucursal_id);
  if (row.estado !== 'RECIBIDA') throw purchaseError.conflict('PURCHASE_PAYMENT_STATE', 'Solo se admiten pagos de compras RECIBIDAS.');
  const method = await tx.metodo_pago.findFirst({ where: { id: input.metodo_pago_id, activo: true } });
  if (!method) throw purchaseError.invalid('Método de pago no disponible.');
  const amount = new Prisma.Decimal(input.monto);
  const paid = row.compra_pago.reduce((sum, payment) => sum.plus(payment.monto), new Prisma.Decimal(0));
  if (paid.plus(amount).gt(row.total)) throw purchaseError.conflict('PURCHASE_OVERPAYMENT', 'El pago excede el saldo de la compra.');
  if (method.es_efectivo) {
    if (!input.sesion_caja_id) throw purchaseError.invalid('Los pagos en efectivo requieren sesion_caja_id.');
    const sessions = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM pos.sesion_caja WHERE id = ${input.sesion_caja_id} FOR UPDATE
    `;
    if (!sessions.length) throw purchaseError.invalid('Sesión de caja no encontrada.');
    const session = await tx.sesion_caja.findUnique({ where: { id: input.sesion_caja_id }, include: { caja: true } });
    if (!session || session.estado !== 'ABIERTA' || session.fecha_cierre !== null ||
      !session.caja.activo || session.caja.sucursal_id !== row.sucursal_id || session.usuario_apertura_id !== actor.userId) {
      throw purchaseError.invalid('Sesión de caja no abierta, no autorizada o ajena a la sucursal.');
    }
    const previousMovements = await tx.movimiento_caja.findMany({
      where: { sesion_caja_id: session.id }, select: { tipo: true, monto: true },
    });
    const expected = previousMovements.reduce((balance, movement) =>
      movement.tipo === 'ENTRADA' ? balance.plus(movement.monto) : balance.minus(movement.monto), session.monto_apertura);
    if (expected.lt(amount)) throw purchaseError.conflict('PURCHASE_CASH_INSUFFICIENT', 'El efectivo esperado de la sesión no cubre el pago.');
  } else if (input.sesion_caja_id !== undefined && input.sesion_caja_id !== null) {
    throw purchaseError.invalid('Los métodos no efectivos no deben indicar sesión de caja.');
  }
  const payment = await tx.compra_pago.create({ data: {
    compra_id: id, metodo_pago_id: input.metodo_pago_id,
    sesion_caja_id: method.es_efectivo ? input.sesion_caja_id! : null,
    monto: amount, referencia: input.referencia ?? null,
  } });
  if (method.es_efectivo) {
    await tx.movimiento_caja.create({ data: {
      sesion_caja_id: input.sesion_caja_id!, usuario_id: actor.userId,
      tipo: 'SALIDA', concepto: `Pago de compra ${row.folio}`,
      monto: amount, referencia: `COMPRA:${id}:PAGO:${payment.id}`,
    } });
  }
  return completeOperation(tx, actor, 'PAGAR', id, key, hash, { pago_id: payment.id.toString() });
}

export const purchaseService = {
  async list(actor: PurchaseActor, input: { estado?: 'BORRADOR' | 'RECIBIDA' | 'CANCELADA'; sucursal_id?: bigint; proveedor_id?: bigint; page: number; pageSize: number }) {
    const allowedBranches = await transact(async (tx) => {
      await validatePurchaseActor(tx, actor);
      const branches = await tx.usuario_sucursal.findMany({ where: { usuario_id: actor.userId },
        select: { sucursal_id: true, sucursal: { select: { empresa_id: true } } } });
      return branches.filter((item) => item.sucursal.empresa_id === actor.empresaId).map((item) => item.sucursal_id);
    });
    if (input.sucursal_id && !allowedBranches.some((id) => id === input.sucursal_id)) throw purchaseError.forbidden();
    const whereBranches = input.sucursal_id ? [input.sucursal_id] : allowedBranches;
    const [rows, total] = await purchaseRepository.list(actor.empresaId, {
      ...(input.estado ? { estado: input.estado } : {}),
      sucursal_id: { in: whereBranches },
      ...(input.proveedor_id ? { proveedor_id: input.proveedor_id } : {}),
    }, input.page, input.pageSize);
    return safePurchaseJson({ items: rows, total, page: input.page, pageSize: input.pageSize });
  },
  get(actor: PurchaseActor, id: bigint) {
    return transact(async (tx) => {
      await validatePurchaseActor(tx, actor);
      return snapshot(tx, actor, id);
    });
  },
  create(actor: PurchaseActor, input: PurchaseCreateInput, key: string) {
    return transact(async (tx) => {
      const content = {
        sucursal_id: input.sucursal_id.toString(), almacen_id: input.almacen_id.toString(),
        proveedor_id: input.proveedor_id.toString(), folio: input.folio,
        factura_proveedor: input.factura_proveedor ?? null, observaciones: input.observaciones ?? null,
        detalles: input.detalles.map((item) => ({ ...item, producto_id: item.producto_id.toString() })),
      };
      const hash = hashPurchaseRequest(actor.userId, 'CREAR', null, content);
      const previous = await replayOrNull(tx, actor, 'CREAR', key, hash);
      if (previous) return previous;
      await validatePurchaseContext(tx, actor, input);
      const created = await tx.compra.create({ data: {
        empresa_id: actor.empresaId, usuario_id: actor.userId, sucursal_id: input.sucursal_id,
        almacen_id: input.almacen_id, proveedor_id: input.proveedor_id,
        folio: input.folio, factura_proveedor: input.factura_proveedor ?? null,
        observaciones: input.observaciones ?? null, estado: 'BORRADOR',
      } });
      for (const item of input.detalles) {
        await tx.compra_detalle.create({ data: {
          compra_id: created.id, producto_id: item.producto_id,
          descripcion: item.descripcion ?? null, cantidad: item.cantidad,
          precio_unitario: item.precio_unitario, descuento_porcentaje: item.descuento_porcentaje,
          tasa_impuesto: item.tasa_impuesto,
        } });
      }
      return completeOperation(tx, actor, 'CREAR', created.id, key, hash);
    });
  },
  receive(actor: PurchaseActor, id: bigint, key: string) {
    return transact((tx) => receiveInTx(tx, actor, id, key));
  },
  pay(actor: PurchaseActor, id: bigint, key: string, input: PurchasePaymentInput) {
    return transact((tx) => payInTx(tx, actor, id, key, input));
  },
  cancel(actor: PurchaseActor, id: bigint, key: string, reason: string) {
    return transact((tx) => cancelInTx(tx, actor, id, key, reason));
  },
};
