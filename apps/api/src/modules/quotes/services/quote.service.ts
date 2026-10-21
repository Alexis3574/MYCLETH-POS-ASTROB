import { Prisma } from '../../../generated/prisma/client.js';
import { prisma } from '../../../lib/prisma.js';
import { quoteDatabaseError, quoteErrors } from '../errors/quote.errors.js';
import { quoteRepository } from '../repositories/quote.repository.js';
import type { QuoteCreate, QuoteDetails, QuoteList, QuoteUpdate } from '../quote.schema.js';
import type { QuoteAction, QuoteActor, QuoteTx } from '../types/quote.types.js';
import { ensureLineFits, jsonSafe, quoteTransitionAllowed, todayInZone } from '../utils/quote-values.js';

const MAX_MONEY = new Prisma.Decimal('999999999999.99');

async function transaction<T>(operation: (tx: QuoteTx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(operation, { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 30000 });
  } catch (error: unknown) {
    throw quoteDatabaseError(error);
  }
}

async function verifyActor(tx: QuoteTx, actor: QuoteActor) {
  const user = await tx.usuario.findFirst({ where: {
    id: actor.userId, empresa_id: actor.empresaId, activo: true, bloqueado: false,
    empresa: { activo: true },
  }, select: { id: true } });
  if (!user) throw quoteErrors.forbidden();
}

async function verifyBranch(tx: QuoteTx, actor: QuoteActor, branchId: bigint, active: boolean) {
  const branch = await tx.sucursal.findFirst({ where: {
    id: branchId, empresa_id: actor.empresaId, ...(active ? { activo: true } : {}),
  }, select: { id: true } });
  if (!branch) throw quoteErrors.notFound();
  const assigned = await tx.usuario_sucursal.findUnique({ where: {
    usuario_id_sucursal_id: { usuario_id: actor.userId, sucursal_id: branchId },
  }, select: { usuario_id: true } });
  if (!assigned) throw quoteErrors.notFound();
}

async function verifyCustomer(tx: QuoteTx, empresaId: bigint, clientId: bigint | null) {
  if (clientId === null) return;
  const customer = await tx.cliente.findFirst({ where: {
    id: clientId, empresa_id: empresaId, activo: true,
  }, select: { id: true } });
  if (!customer) throw quoteErrors.invalid('Cliente inactivo, inexistente o de otra empresa.');
}

async function prepareDetails(tx: QuoteTx, actor: QuoteActor, details: QuoteDetails) {
  const prepared: Array<{
    producto_id: bigint; descripcion: string | null; cantidad: string; precio_unitario: string;
    descuento_porcentaje: string; tasa_impuesto: string;
  }> = [];
  let cumulative = new Prisma.Decimal(0);
  for (const item of details) {
    const product = await tx.producto.findFirst({
      where: { id: item.producto_id, empresa_id: actor.empresaId, activo: true },
      include: {
        unidad_medida: { select: { activo: true, permite_decimales: true } },
        producto_impuesto: { include: { impuesto: { select: { empresa_id: true, activo: true, tasa: true } } } },
      },
    });
    if (!product || !product.unidad_medida.activo) {
      throw quoteErrors.invalid('Producto inexistente, inactivo o ajeno a la empresa.');
    }
    if (!product.unidad_medida.permite_decimales && !new Prisma.Decimal(item.cantidad).isInteger()) {
      throw quoteErrors.invalid(`El producto ${product.sku} exige cantidades enteras.`);
    }
    let tax = new Prisma.Decimal(0);
    for (const link of product.producto_impuesto) {
      if (link.impuesto.empresa_id !== actor.empresaId) {
        throw quoteErrors.invalid('Configuración de impuestos de otra empresa.');
      }
      if (link.impuesto.activo) tax = tax.plus(link.impuesto.tasa);
    }
    if (tax.gt(100)) throw quoteErrors.invalid('Suma de impuestos del producto superior a 100%.');
    const rate = tax.toFixed(4);
    const price = product.precio_venta.toFixed(4);
    try { ensureLineFits(item.cantidad, price, item.descuento_porcentaje, rate); }
    catch { throw quoteErrors.invalid('Importes fuera del rango NUMERIC(14,2).'); }
    const sub = new Prisma.Decimal(item.cantidad).mul(price).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const discount = sub.mul(item.descuento_porcentaje).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const taxAmount = sub.minus(discount).mul(rate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    cumulative = cumulative.plus(sub.minus(discount).plus(taxAmount));
    if (cumulative.gt(MAX_MONEY)) throw quoteErrors.invalid('El total excede el límite de la cotización.');
    prepared.push({
      producto_id: item.producto_id,
      descripcion: item.descripcion ?? product.nombre,
      cantidad: item.cantidad,
      precio_unitario: price,
      descuento_porcentaje: item.descuento_porcentaje,
      tasa_impuesto: rate,
    });
  }
  return prepared;
}

async function createDetails(tx: QuoteTx, id: bigint, prepared: Awaited<ReturnType<typeof prepareDetails>>) {
  for (const row of prepared) {
    // El trigger calcula líneas y actualiza la cabecera; nunca escribimos importes calculados manualmente.
    await tx.cotizacion_detalle.create({ data: { ...row, cotizacion_id: id } });
  }
}

async function snapshot(tx: QuoteTx, actor: QuoteActor, id: bigint) {
  const result = await quoteRepository.find(tx, actor.empresaId, id);
  if (!result) throw quoteErrors.notFound();
  return jsonSafe(result);
}

async function audit(tx: QuoteTx, actor: QuoteActor, id: bigint, action: string) {
  await tx.auditoria.create({ data: {
    usuario_id: actor.userId, tabla: 'cotizacion', registro_id: id, accion: action === "CREAR" ? "INSERT" : "UPDATE",
    datos_nuevos: { modulo: 'COTIZACIONES', accion: action },
  } });
}

async function lockQuote(tx: QuoteTx, actor: QuoteActor, id: bigint) {
  await verifyActor(tx, actor);
  if (!await quoteRepository.lock(tx, actor.empresaId, id)) throw quoteErrors.notFound();
  const quote = await quoteRepository.find(tx, actor.empresaId, id);
  if (!quote) throw quoteErrors.notFound();
  await verifyBranch(tx, actor, quote.sucursal_id, false);
  return quote;
}

async function checkValidUntil(tx: QuoteTx, empresaId: bigint, until: Date | null) {
  if (until === null) return false;
  const company = await tx.empresa.findUnique({ where: { id: empresaId }, select: { zona_horaria: true } });
  if (!company) throw quoteErrors.notFound();
  let today: string;
  try { today = todayInZone(company.zona_horaria); }
  catch { throw quoteErrors.invalid('La zona horaria de la empresa es inválida.'); }
  return until.toISOString().slice(0, 10) < today;
}

export const quoteService = {
  async list(actor: QuoteActor, input: QuoteList) {
    const actorIsValid = await prisma.usuario.findFirst({ where: {
      id: actor.userId, empresa_id: actor.empresaId, activo: true, bloqueado: false,
      empresa: { activo: true },
    }, select: { id: true } });
    if (!actorIsValid) throw quoteErrors.forbidden();
    const assignments = await prisma.usuario_sucursal.findMany({ where: {
      usuario_id: actor.userId, sucursal: { empresa_id: actor.empresaId },
    }, select: { sucursal_id: true } });
    const branches = assignments.map(a => a.sucursal_id);
    if (input.sucursal_id !== undefined && !branches.includes(input.sucursal_id)) throw quoteErrors.notFound();
    return jsonSafe(await quoteRepository.list(actor.empresaId, branches, input));
  },
  async get(actor: QuoteActor, id: bigint) {
    const quote = await prisma.cotizacion.findFirst({ where: { id, empresa_id: actor.empresaId }, select: { sucursal_id: true } });
    if (!quote) throw quoteErrors.notFound();
    await transaction(async tx => { await verifyActor(tx, actor); await verifyBranch(tx, actor, quote.sucursal_id, false); });
    const result = await quoteRepository.find(prisma, actor.empresaId, id);
    if (!result) throw quoteErrors.notFound();
    return jsonSafe(result);
  },
  create(actor: QuoteActor, input: QuoteCreate) {
    return transaction(async tx => {
      await verifyActor(tx, actor);
      await verifyBranch(tx, actor, input.sucursal_id, true);
      await verifyCustomer(tx, actor.empresaId, input.cliente_id ?? null);
      const details = await prepareDetails(tx, actor, input.detalles);
      const row = await tx.cotizacion.create({ data: {
        empresa_id: actor.empresaId, sucursal_id: input.sucursal_id,
        usuario_id: actor.userId, cliente_id: input.cliente_id ?? null,
        folio: input.folio, estado: 'BORRADOR',
        valida_hasta: input.valida_hasta ? new Date(`${input.valida_hasta}T00:00:00.000Z`) : null,
        observaciones: input.observaciones ?? null,
      } });
      await createDetails(tx, row.id, details);
      await audit(tx, actor, row.id, 'CREAR');
      return snapshot(tx, actor, row.id);
    });
  },
  update(actor: QuoteActor, id: bigint, input: QuoteUpdate) {
    return transaction(async tx => {
      const row = await lockQuote(tx, actor, id);
      if (row.estado !== 'BORRADOR') throw quoteErrors.conflict('Solo se pueden editar cotizaciones en BORRADOR.');
      await verifyBranch(tx, actor, row.sucursal_id, true);
      if (input.cliente_id !== undefined) await verifyCustomer(tx, actor.empresaId, input.cliente_id);
      const details = input.detalles === undefined ? null : await prepareDetails(tx, actor, input.detalles);
      await tx.cotizacion.update({ where: { id }, data: {
        ...(input.cliente_id !== undefined ? { cliente_id: input.cliente_id } : {}),
        ...(input.valida_hasta !== undefined ? {
          valida_hasta: input.valida_hasta ? new Date(`${input.valida_hasta}T00:00:00.000Z`) : null,
        } : {}),
        ...(input.observaciones !== undefined ? { observaciones: input.observaciones } : {}),
      } });
      if (details !== null) {
        await tx.cotizacion_detalle.deleteMany({ where: { cotizacion_id: id } });
        await createDetails(tx, id, details);
      }
      await audit(tx, actor, id, 'ACTUALIZAR');
      return snapshot(tx, actor, id);
    });
  },
  changeState(actor: QuoteActor, id: bigint, action: QuoteAction) {
    return transaction(async tx => {
      const row = await lockQuote(tx, actor, id);
      if (!quoteTransitionAllowed(row.estado, action)) throw quoteErrors.conflict('Transición de estado no permitida.');
      if (action === 'send' || action === 'accept') {
        await verifyBranch(tx, actor, row.sucursal_id, true);
        if (await checkValidUntil(tx, actor.empresaId, row.valida_hasta)) throw quoteErrors.conflict('Cotización vencida.');
        if (row.cliente_id !== null) await verifyCustomer(tx, actor.empresaId, row.cliente_id);
        if (!row.cotizacion_detalle.length) throw quoteErrors.invalid('Cotización sin productos.');
      }
      if (action === 'expire') {
        if (row.valida_hasta === null || !await checkValidUntil(tx, actor.empresaId, row.valida_hasta)) {
          throw quoteErrors.conflict('La cotización aún no está vencida.');
        }
      }
      const states: Record<QuoteAction, string> = {
        send: 'ENVIADA', accept: 'ACEPTADA', reject: 'RECHAZADA',
        cancel: 'CANCELADA', expire: 'VENCIDA',
      };
      await tx.cotizacion.update({ where: { id }, data: { estado: states[action] } });
      await audit(tx, actor, id, states[action]);
      return snapshot(tx, actor, id);
    });
  },
};
