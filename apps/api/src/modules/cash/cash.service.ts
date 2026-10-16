import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { cashError } from "./cash.errors.js";
import { computeExpected, decimal } from "./cash.utils.js";

export interface CashActor { empresaId: bigint; userId: bigint }
type Tx = Prisma.TransactionClient;

const scope = (actor: CashActor) => ({
  sucursal: {
    empresa_id: actor.empresaId,
    usuario_sucursal: { some: { usuario_id: actor.userId } },
  },
});

async function requireBranch(tx: Tx, actor: CashActor, branchId: bigint) {
  const branch = await tx.sucursal.findFirst({
    where: {
      id: branchId,
      empresa_id: actor.empresaId,
      activo: true,
      usuario_sucursal: { some: { usuario_id: actor.userId } },
    },
    select: { id: true },
  });
  if (!branch) throw cashError.forbidden();
  return branch;
}

async function findCash(tx: Tx, actor: CashActor, cashId: bigint) {
  const cash = await tx.caja.findFirst({
    where: { id: cashId, ...scope(actor) },
    select: {
      id: true, sucursal_id: true, codigo: true, nombre: true,
      activo: true, creado_en: true, actualizado_en: true,
    },
  });
  if (!cash) throw cashError.notFound();
  return cash;
}

async function lockCash(tx: Tx, actor: CashActor, cashId: bigint) {
  await tx.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM "pos"."caja" WHERE id = ${cashId} FOR UPDATE
  `;
  return findCash(tx, actor, cashId);
}

async function findSession(tx: Tx, actor: CashActor, sessionId: bigint) {
  const session = await tx.sesion_caja.findFirst({
    where: { id: sessionId, caja: scope(actor) },
    include: { caja: { select: { id: true, sucursal_id: true, codigo: true, activo: true } } },
  });
  if (!session) throw cashError.notFound();
  return session;
}

async function lockSession(tx: Tx, actor: CashActor, sessionId: bigint) {
  await tx.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM "pos"."sesion_caja" WHERE id = ${sessionId} FOR UPDATE
  `;
  return findSession(tx, actor, sessionId);
}

async function audit(tx: Tx, actor: CashActor, table: string, id: bigint, action: string, details: Record<string, string | number | boolean | null>) {
  await tx.auditoria.create({
    data: {
      usuario_id: actor.userId,
      tabla: table,
      registro_id: id,
      accion: action === "CREAR" || action === "ABRIR" ? "INSERT" : "UPDATE",
      datos_nuevos: { tipo_operacion: action, ...details },
    },
  });
}

async function cashBalance(tx: Tx, sessionId: bigint, opening: Prisma.Decimal) {
  const grouped = await tx.movimiento_caja.groupBy({
    by: ["tipo"],
    where: { sesion_caja_id: sessionId },
    _sum: { monto: true },
  });
  const expected = computeExpected(opening, grouped);
  return { expected, grouped };
}

function assertOpen(session: { estado: string; fecha_cierre: Date | null; caja: { activo: boolean }; usuario_apertura_id: bigint }, actor: CashActor) {
  if (session.estado !== "ABIERTA" || session.fecha_cierre !== null) {
    throw cashError.conflict("La sesión ya está cerrada.");
  }
  if (!session.caja.activo) throw cashError.conflict("La caja está inactiva.");
  if (session.usuario_apertura_id !== actor.userId) {
    throw cashError.forbidden();
  }
}

export const cashService = {
  async list(actor: CashActor, page: number, pageSize: number, branchId?: bigint) {
    const where = { ...scope(actor), ...(branchId ? { sucursal_id: branchId } : {}) };
    const [items, total] = await prisma.$transaction([
      prisma.caja.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.caja.count({ where }),
    ]);
    return { items, page, pageSize, total };
  },

  async get(actor: CashActor, cashId: bigint) {
    return findCash(prisma, actor, cashId);
  },

  async create(actor: CashActor, input: { sucursal_id: string; codigo: string; nombre: string }) {
    return prisma.$transaction(async (tx) => {
      await requireBranch(tx, actor, BigInt(input.sucursal_id));
      const exists = await tx.caja.findFirst({
        where: { sucursal_id: BigInt(input.sucursal_id), codigo: input.codigo },
        select: { id: true },
      });
      if (exists) throw cashError.conflict("Ya existe una caja con ese código en la sucursal.");
      const record = await tx.caja.create({
        data: { sucursal_id: BigInt(input.sucursal_id), codigo: input.codigo, nombre: input.nombre },
      });
      await audit(tx, actor, "caja", record.id, "CREAR", { codigo: input.codigo, sucursal_id: input.sucursal_id });
      return record;
    });
  },

  async update(actor: CashActor, cashId: bigint, input: { codigo?: string; nombre?: string; activo?: boolean }) {
    return prisma.$transaction(async (tx) => {
      const current = await lockCash(tx, actor, cashId);
      if (input.activo === false) {
        const active = await tx.sesion_caja.count({ where: { caja_id: cashId, estado: "ABIERTA" } });
        if (active > 0) throw cashError.conflict("No puede desactivarse una caja con sesión abierta.");
      }
      const updated = await tx.caja.update({
        where: { id: cashId },
        data: { ...input, actualizado_en: new Date() },
      });
      await audit(tx, actor, "caja", updated.id, "ACTUALIZAR", {
        codigo_anterior: current.codigo,
        codigo_nuevo: updated.codigo,
        activo_anterior: current.activo,
        activo_nuevo: updated.activo,
      });
      return updated;
    });
  },

  async open(actor: CashActor, cashId: bigint, input: { monto_apertura: string; notas?: string | null }) {
    return prisma.$transaction(async (tx) => {
      const cash = await lockCash(tx, actor, cashId);
      if (!cash.activo) throw cashError.conflict("La caja está inactiva.");
      await requireBranch(tx, actor, cash.sucursal_id);
      const active = await tx.sesion_caja.findFirst({
        where: { caja_id: cashId, estado: "ABIERTA" }, select: { id: true },
      });
      if (active) throw cashError.conflict("Ya existe una sesión abierta para esta caja.");
      const session = await tx.sesion_caja.create({
        data: {
          caja_id: cashId,
          usuario_apertura_id: actor.userId,
          monto_apertura: decimal(input.monto_apertura),
          notas: input.notas ?? null,
          estado: "ABIERTA",
        },
      });
      await audit(tx, actor, "sesion_caja", session.id, "ABRIR", {
        caja_id: String(cashId), monto_apertura: input.monto_apertura,
      });
      return session;
    });
  },

  async current(actor: CashActor, cashId: bigint) {
    await findCash(prisma, actor, cashId);
    return prisma.sesion_caja.findFirst({
      where: { caja_id: cashId, estado: "ABIERTA" },
      orderBy: { fecha_apertura: "desc" },
    });
  },

  async history(actor: CashActor, cashId: bigint, page: number, pageSize: number) {
    await findCash(prisma, actor, cashId);
    const where = { caja_id: cashId };
    const [items, total] = await prisma.$transaction([
      prisma.sesion_caja.findMany({ where, orderBy: { fecha_apertura: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.sesion_caja.count({ where }),
    ]);
    return { items, page, pageSize, total };
  },

  async session(actor: CashActor, sessionId: bigint) {
    const session = await findSession(prisma, actor, sessionId);
    const { expected, grouped } = await cashBalance(prisma, sessionId, session.monto_apertura);
    return { ...session, monto_esperado_actual: expected.toFixed(2), resumen_movimientos: grouped };
  },

  async movements(actor: CashActor, sessionId: bigint, page: number, pageSize: number) {
    await findSession(prisma, actor, sessionId);
    const where = { sesion_caja_id: sessionId };
    const [items, total] = await prisma.$transaction([
      prisma.movimiento_caja.findMany({ where, orderBy: [{ fecha: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      prisma.movimiento_caja.count({ where }),
    ]);
    return { items, total, page, pageSize };
  },

  async move(actor: CashActor, sessionId: bigint, input: { tipo: "ENTRADA" | "SALIDA"; concepto: string; monto: string; referencia: string }) {
    return prisma.$transaction(async (tx) => {
      const session = await lockSession(tx, actor, sessionId);
      assertOpen(session, actor);
      const reference = `MANUAL:${input.referencia}`;
      const duplicate = await tx.movimiento_caja.findFirst({
        where: { sesion_caja_id: sessionId, referencia: reference }, select: { id: true },
      });
      if (duplicate) throw cashError.conflict("La referencia ya fue registrada en esta sesión.");
      if (input.tipo === "SALIDA") {
        const { expected } = await cashBalance(tx, sessionId, session.monto_apertura);
        if (expected.lessThan(decimal(input.monto))) {
          throw cashError.conflict("El retiro supera el efectivo esperado en la sesión.");
        }
      }
      const record = await tx.movimiento_caja.create({
        data: {
          sesion_caja_id: sessionId,
          usuario_id: actor.userId,
          tipo: input.tipo,
          concepto: input.concepto,
          monto: decimal(input.monto),
          referencia: reference,
        },
      });
      await audit(tx, actor, "movimiento_caja", record.id, "CREAR", {
        sesion_caja_id: String(sessionId), tipo: record.tipo,
        monto: input.monto, referencia: reference,
      });
      return record;
    });
  },

  async close(actor: CashActor, sessionId: bigint, input: { monto_cierre: string; notas?: string | null }) {
    return prisma.$transaction(async (tx) => {
      const session = await lockSession(tx, actor, sessionId);
      assertOpen(session, actor);
      const { expected } = await cashBalance(tx, sessionId, session.monto_apertura);
      const counted = decimal(input.monto_cierre);
      const difference = counted.minus(expected);
      const updated = await tx.sesion_caja.update({
        where: { id: sessionId },
        data: {
          monto_esperado: expected,
          monto_cierre: counted,
          diferencia: difference,
          fecha_cierre: new Date(),
          usuario_cierre_id: actor.userId,
          estado: "CERRADA",
          notas: input.notas ?? session.notas,
          actualizado_en: new Date(),
        },
      });
      await audit(tx, actor, "sesion_caja", sessionId, "CERRAR", {
        efectivo_esperado: expected.toFixed(2),
        efectivo_contado: counted.toFixed(2),
        diferencia: difference.toFixed(2),
      });
      return updated;
    });
  },
};
