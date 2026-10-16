import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { z } from "zod";
import type {
  createCustomerSchema, updateCustomerSchema, customerListSchema,
  createCustomerAddressSchema, updateCustomerAddressSchema,
} from "./customer.schema.js";
import { customerError } from "./customer.errors.js";

export interface CustomerActor { empresaId: bigint; userId: bigint }
type Tx = Prisma.TransactionClient;
type CreateCustomer = z.infer<typeof createCustomerSchema>;
type UpdateCustomer = z.infer<typeof updateCustomerSchema>;
type CustomerList = z.infer<typeof customerListSchema>;
type CreateAddress = z.infer<typeof createCustomerAddressSchema>;
type UpdateAddress = z.infer<typeof updateCustomerAddressSchema>;

async function findClient(tx: Tx, actor: CustomerActor, customerId: bigint) {
  const record = await tx.cliente.findFirst({
    where: { id: customerId, empresa_id: actor.empresaId },
    include: { cliente_direccion: { orderBy: { id: "asc" } } },
  });
  if (!record) throw customerError.notFound();
  return record;
}

// A shared parent-row lock serializes address-primary changes with one another.
async function lockClient(tx: Tx, actor: CustomerActor, customerId: bigint) {
  await tx.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM "pos"."cliente"
    WHERE id = ${customerId} AND empresa_id = ${actor.empresaId}
    FOR UPDATE
  `;
  return findClient(tx, actor, customerId);
}

async function audit(
  tx: Tx, actor: CustomerActor, table: string, recordId: bigint,
  action: "INSERT" | "UPDATE" | "DELETE", changes: Record<string, string | number | boolean | null>,
) {
  await tx.auditoria.create({
    data: { usuario_id: actor.userId, tabla: table, registro_id: recordId, accion: action, datos_nuevos: changes },
  });
}

async function findAddress(tx: Tx, customerId: bigint, addressId: bigint) {
  const record = await tx.cliente_direccion.findFirst({
    where: { id: addressId, cliente_id: customerId },
  });
  if (!record) throw customerError.notFound();
  return record;
}

export const customerService = {
  async list(actor: CustomerActor, input: CustomerList) {
    const filter = input.q?.trim();
    const where: Prisma.clienteWhereInput = {
      empresa_id: actor.empresaId,
      ...(input.activo === undefined ? {} : { activo: input.activo === "true" }),
      ...(filter ? {
        OR: [
          { nombre: { contains: filter, mode: "insensitive" } },
          { codigo: { contains: filter, mode: "insensitive" } },
          { rfc: { contains: filter, mode: "insensitive" } },
          { email: { contains: filter, mode: "insensitive" } },
          { telefono: { contains: filter, mode: "insensitive" } },
        ],
      } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.cliente.findMany({
        where, orderBy: [{ nombre: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize, take: input.pageSize,
      }),
      prisma.cliente.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  },

  async get(actor: CustomerActor, customerId: bigint) {
    return findClient(prisma, actor, customerId);
  },

  async create(actor: CustomerActor, input: CreateCustomer) {
    return prisma.$transaction(async (tx) => {
      const duplicate = await tx.cliente.findFirst({
        where: { empresa_id: actor.empresaId, codigo: input.codigo }, select: { id: true },
      });
      if (duplicate) throw customerError.conflict("Ya existe un cliente con ese código en la empresa.");
      const record = await tx.cliente.create({
        data: {
          empresa_id: actor.empresaId,
          codigo: input.codigo,
          nombre: input.nombre,
          rfc: input.rfc ?? null,
          email: input.email ?? null,
          telefono: input.telefono ?? null,
          limite_credito: input.limite_credito ?? "0.00",
          dias_credito: input.dias_credito ?? 0,
          activo: input.activo ?? true,
        },
      });
      await audit(tx, actor, "cliente", record.id, "INSERT", {
        empresa_id: String(actor.empresaId), codigo: record.codigo, nombre: record.nombre,
      });
      return record;
    });
  },

  async update(actor: CustomerActor, customerId: bigint, input: UpdateCustomer) {
    return prisma.$transaction(async (tx) => {
      const current = await lockClient(tx, actor, customerId);
      const record = await tx.cliente.update({
        where: { id: customerId },
        data: { ...input, actualizado_en: new Date() },
      });
      await audit(tx, actor, "cliente", record.id, "UPDATE", {
        codigo_anterior: current.codigo,
        codigo_nuevo: record.codigo,
        activo_anterior: current.activo,
        activo_nuevo: record.activo,
      });
      return record;
    });
  },

  async addresses(actor: CustomerActor, customerId: bigint) {
    const record = await findClient(prisma, actor, customerId);
    return record.cliente_direccion;
  },

  async createAddress(actor: CustomerActor, customerId: bigint, input: CreateAddress) {
    return prisma.$transaction(async (tx) => {
      await lockClient(tx, actor, customerId);
      const count = await tx.cliente_direccion.count({ where: { cliente_id: customerId } });
      const main = input.es_principal ?? (count === 0);
      if (main) {
        await tx.cliente_direccion.updateMany({
          where: { cliente_id: customerId, es_principal: true }, data: { es_principal: false },
        });
      }
      const address = await tx.cliente_direccion.create({
        data: {
          ...input,
          cliente_id: customerId,
          es_principal: main,
          pais: input.pais ?? "México",
        },
      });
      await audit(tx, actor, "cliente_direccion", address.id, "INSERT", {
        cliente_id: String(customerId), tipo: address.tipo, es_principal: address.es_principal,
      });
      return address;
    });
  },

  async updateAddress(actor: CustomerActor, customerId: bigint, addressId: bigint, input: UpdateAddress) {
    return prisma.$transaction(async (tx) => {
      await lockClient(tx, actor, customerId);
      const previous = await findAddress(tx, customerId, addressId);
      if (previous.es_principal && input.es_principal === false) {
        throw customerError.conflict("Para cambiar la dirección principal, marque otra dirección como principal.");
      }
      if (input.es_principal === true) {
        await tx.cliente_direccion.updateMany({
          where: { cliente_id: customerId, es_principal: true }, data: { es_principal: false },
        });
      }
      const updated = await tx.cliente_direccion.update({ where: { id: addressId }, data: input });
      await audit(tx, actor, "cliente_direccion", addressId, "UPDATE", {
        cliente_id: String(customerId), tipo: updated.tipo, es_principal: updated.es_principal,
      });
      return updated;
    });
  },

  async deleteAddress(actor: CustomerActor, customerId: bigint, addressId: bigint) {
    return prisma.$transaction(async (tx) => {
      await lockClient(tx, actor, customerId);
      const current = await findAddress(tx, customerId, addressId);
      if (current.es_principal) {
        const other = await tx.cliente_direccion.count({
          where: { cliente_id: customerId, id: { not: addressId } },
        });
        if (other !== 0) {
          throw customerError.conflict("Designe otra dirección principal antes de eliminar ésta.");
        }
      }
      await tx.cliente_direccion.delete({ where: { id: addressId } });
      await audit(tx, actor, "cliente_direccion", addressId, "DELETE", {
        cliente_id: String(customerId), tipo: current.tipo,
      });
      return { id: String(addressId), eliminado: true };
    });
  },
};
