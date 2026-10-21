import { prisma } from "../../../lib/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import type { z } from "zod";
import {
  companyUpdateSchema, branchCreateSchema, branchUpdateSchema, branchListSchema,
  warehouseCreateSchema, warehouseUpdateSchema, warehouseListSchema, assignmentCreateSchema,
} from "../organization.schema.js";
import { organizationError } from "../errors/organization.errors.js";
import type { OrganizationActor, OrganizationTransaction as Tx } from "../types/organization.types.js";
import { audit, requireBranch, requireCompany, requireWarehouse, ensureFreeBranch, ensureFreeWarehouse } from "../repositories/organization.repository.js";

type CompanyUpdate = z.infer<typeof companyUpdateSchema>;
type BranchCreate = z.infer<typeof branchCreateSchema>;
type BranchUpdate = z.infer<typeof branchUpdateSchema>;
type BranchList = z.infer<typeof branchListSchema>;
type WarehouseCreate = z.infer<typeof warehouseCreateSchema>;
type WarehouseUpdate = z.infer<typeof warehouseUpdateSchema>;
type WarehouseList = z.infer<typeof warehouseListSchema>;
type AssignmentCreate = z.infer<typeof assignmentCreateSchema>;

async function write<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(work, { isolationLevel: "ReadCommitted", timeout: 15000 });
}
const contains = (q: string | undefined) => q?.trim() || undefined;

export const organizationService = {
  async company(actor: OrganizationActor) {
    const record = await prisma.empresa.findUnique({ where: { id: actor.empresaId } });
    if (!record?.activo) throw organizationError.forbidden();
    return record;
  },
  async updateCompany(actor: OrganizationActor, input: CompanyUpdate) {
    return write(async (tx) => {
      const before = await requireCompany(tx, actor, true);
      const updated = await tx.empresa.update({ where: { id: actor.empresaId }, data: input });
      await audit(tx, actor, "empresa", updated.id, "UPDATE", {
        nombre_anterior: before.nombre_comercial, nombre_nuevo: updated.nombre_comercial,
      });
      // No se admite cambiar 'activo' desde este endpoint: evitar el autobloqueo del tenant.
      return updated;
    });
  },
  async branches(actor: OrganizationActor, input: BranchList) {
    const q = contains(input.q);
    const where: Prisma.sucursalWhereInput = {
      empresa_id: actor.empresaId,
      ...(input.activo ? { activo: input.activo === "true" } : {}),
      ...(q ? { OR: [
        { codigo: { contains: q, mode: "insensitive" } },
        { nombre: { contains: q, mode: "insensitive" } },
      ] } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.sucursal.findMany({ where, orderBy: [{ nombre: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
      prisma.sucursal.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  },
  async branch(actor: OrganizationActor, id: bigint) {
    const item = await prisma.sucursal.findFirst({ where: { id, empresa_id: actor.empresaId } });
    if (!item) throw organizationError.notFound("Sucursal");
    return item;
  },
  async createBranch(actor: OrganizationActor, input: BranchCreate) {
    return write(async (tx) => {
      await requireCompany(tx, actor, true);
      const duplicate = await tx.sucursal.findFirst({ where: {
        empresa_id: actor.empresaId, codigo: { equals: input.codigo, mode: "insensitive" },
      }, select: { id: true } });
      if (duplicate) throw organizationError.conflict("Código de sucursal ya registrado en la empresa.");
      const record = await tx.sucursal.create({ data: { ...input, empresa_id: actor.empresaId } });
      await audit(tx, actor, "sucursal", record.id, "INSERT", {
        empresa_id: String(actor.empresaId), codigo: record.codigo,
      });
      return record;
    });
  },
  async updateBranch(actor: OrganizationActor, id: bigint, input: BranchUpdate) {
    return write(async (tx) => {
      await requireCompany(tx, actor, true);
      const before = await requireBranch(tx, actor, id, true);
      if (input.activo === false && before.activo) await ensureFreeBranch(tx, id);
      if (input.codigo && input.codigo !== before.codigo) {
        const duplicate = await tx.sucursal.findFirst({ where: {
          empresa_id: actor.empresaId, id: { not: id }, codigo: { equals: input.codigo, mode: "insensitive" },
        }, select: { id: true } });
        if (duplicate) throw organizationError.conflict("Código de sucursal ya registrado.");
      }
      const record = await tx.sucursal.update({ where: { id }, data: input });
      await audit(tx, actor, "sucursal", record.id, "UPDATE", {
        codigo_anterior: before.codigo, codigo_nuevo: record.codigo,
        activo_anterior: before.activo, activo_nuevo: record.activo,
      });
      return record;
    });
  },
  async warehouses(actor: OrganizationActor, input: WarehouseList) {
    const q = contains(input.q);
    const where: Prisma.almacenWhereInput = {
      sucursal: { empresa_id: actor.empresaId },
      ...(input.sucursal_id ? { sucursal_id: input.sucursal_id } : {}),
      ...(input.activo ? { activo: input.activo === "true" } : {}),
      ...(q ? { OR: [
        { codigo: { contains: q, mode: "insensitive" } },
        { nombre: { contains: q, mode: "insensitive" } },
      ] } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.almacen.findMany({ where, include: { sucursal: { select: { id: true, codigo: true, nombre: true, activo: true } } },
        orderBy: [{ sucursal_id: "asc" }, { nombre: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
      prisma.almacen.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  },
  async warehouse(actor: OrganizationActor, id: bigint) {
    return requireWarehouse(prisma, actor, id);
  },
  async createWarehouse(actor: OrganizationActor, input: WarehouseCreate) {
    return write(async (tx) => {
      await requireCompany(tx, actor, true);
      const branch = await requireBranch(tx, actor, input.sucursal_id, true);
      if (!branch.activo) throw organizationError.conflict("No se puede registrar un almacén en una sucursal inactiva.");
      const duplicate = await tx.almacen.findFirst({ where: {
        sucursal_id: branch.id, codigo: { equals: input.codigo, mode: "insensitive" },
      }, select: { id: true } });
      if (duplicate) throw organizationError.conflict("Código de almacén ya registrado en la sucursal.");
      const record = await tx.almacen.create({ data: { ...input, sucursal_id: branch.id } });
      await audit(tx, actor, "almacen", record.id, "INSERT", {
        sucursal_id: String(branch.id), codigo: record.codigo,
      });
      return record;
    });
  },
  async updateWarehouse(actor: OrganizationActor, id: bigint, input: WarehouseUpdate) {
    return write(async (tx) => {
      await requireCompany(tx, actor, true);
      const initial = await requireWarehouse(tx, actor, id);
      const branch = await requireBranch(tx, actor, initial.sucursal_id, true);
      const before = await requireWarehouse(tx, actor, id, true);
      if (input.activo === true && !branch.activo) throw organizationError.conflict("No se puede activar un almacén si la sucursal está inactiva.");
      if (input.activo === false && before.activo) await ensureFreeWarehouse(tx, id);
      if (input.codigo && input.codigo !== before.codigo) {
        const duplicate = await tx.almacen.findFirst({ where: {
          sucursal_id: branch.id, id: { not: id }, codigo: { equals: input.codigo, mode: "insensitive" },
        }, select: { id: true } });
        if (duplicate) throw organizationError.conflict("Código de almacén ya registrado.");
      }
      const record = await tx.almacen.update({ where: { id }, data: input });
      await audit(tx, actor, "almacen", record.id, "UPDATE", {
        codigo_anterior: before.codigo, codigo_nuevo: record.codigo,
        activo_anterior: before.activo, activo_nuevo: record.activo,
      });
      return record;
    });
  },
  async branchUsers(actor: OrganizationActor, branchId: bigint) {
    await this.branch(actor, branchId);
    return prisma.usuario_sucursal.findMany({
      where: { sucursal_id: branchId, usuario: { empresa_id: actor.empresaId } },
      select: { usuario_id: true, sucursal_id: true, es_predeterminada: true,
        usuario: { select: { id: true, username: true, nombre: true, activo: true } } },
      orderBy: { usuario_id: "asc" },
    });
  },
  async assignBranchUser(actor: OrganizationActor, branchId: bigint, input: AssignmentCreate) {
    return write(async (tx) => {
      await requireCompany(tx, actor, true);
      const branch = await requireBranch(tx, actor, branchId, true);
      if (!branch.activo) throw organizationError.conflict("Sucursal inactiva.");
      await tx.$queryRaw`SELECT id FROM "pos"."usuario" WHERE id = ${input.usuario_id} AND empresa_id = ${actor.empresaId} FOR UPDATE`;
      const user = await tx.usuario.findFirst({ where: { id: input.usuario_id, empresa_id: actor.empresaId, activo: true } });
      if (!user) throw organizationError.notFound("Usuario");
      const existing = await tx.usuario_sucursal.findUnique({ where: {
        usuario_id_sucursal_id: { usuario_id: input.usuario_id, sucursal_id: branchId },
      } });
      if (existing && input.es_predeterminada === undefined) return existing;
      const defaultCount = await tx.usuario_sucursal.count({ where: {
        usuario_id: input.usuario_id, es_predeterminada: true,
      } });
      const setDefault = input.es_predeterminada === true || (!existing && defaultCount === 0);
      if (setDefault) await tx.usuario_sucursal.updateMany({ where: { usuario_id: input.usuario_id }, data: { es_predeterminada: false } });
      const record = await tx.usuario_sucursal.upsert({
        where: { usuario_id_sucursal_id: { usuario_id: input.usuario_id, sucursal_id: branchId } },
        create: { usuario_id: input.usuario_id, sucursal_id: branchId, es_predeterminada: setDefault },
        update: { es_predeterminada: setDefault ? true : existing?.es_predeterminada ?? false },
      });
      await audit(tx, actor, "usuario_sucursal", branchId, existing ? "UPDATE" : "INSERT", {
        usuario_id: String(input.usuario_id), sucursal_id: String(branchId), predeterminada: record.es_predeterminada,
      });
      return record;
    });
  },
  async unassignBranchUser(actor: OrganizationActor, branchId: bigint, userId: bigint) {
    return write(async (tx) => {
      await requireCompany(tx, actor, true);
      await requireBranch(tx, actor, branchId, true);
      await tx.$queryRaw`SELECT id FROM "pos"."usuario" WHERE id = ${userId} AND empresa_id = ${actor.empresaId} FOR UPDATE`;
      const user = await tx.usuario.findFirst({ where: { id: userId, empresa_id: actor.empresaId } });
      if (!user) throw organizationError.notFound("Usuario");
      const assignment = await tx.usuario_sucursal.findUnique({ where: {
        usuario_id_sucursal_id: { usuario_id: userId, sucursal_id: branchId },
      } });
      if (!assignment) throw organizationError.notFound("Asignación");
      const others = await tx.usuario_sucursal.findMany({ where: {
        usuario_id: userId, sucursal_id: { not: branchId }, sucursal: { empresa_id: actor.empresaId, activo: true },
      }, orderBy: { sucursal_id: "asc" }, select: { sucursal_id: true, es_predeterminada: true } });
      if (actor.userId === userId && others.length === 0) {
        throw organizationError.conflict("No puede quitarse la última sucursal activa a sí mismo.");
      }
      await tx.usuario_sucursal.delete({ where: { usuario_id_sucursal_id: { usuario_id: userId, sucursal_id: branchId } } });
      if (assignment.es_predeterminada && others.length) {
        await tx.usuario_sucursal.update({ where: {
          usuario_id_sucursal_id: { usuario_id: userId, sucursal_id: others[0]!.sucursal_id },
        }, data: { es_predeterminada: true } });
      }
      await audit(tx, actor, "usuario_sucursal", branchId, "DELETE", {
        usuario_id: String(userId), sucursal_id: String(branchId),
      });
      return { usuario_id: userId, sucursal_id: branchId, removido: true };
    });
  },
};
