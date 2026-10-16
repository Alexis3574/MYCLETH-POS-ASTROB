import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { z } from "zod";
import type {
  createSupplierSchema, updateSupplierSchema, supplierListSchema,
  createSupplierAddressSchema, updateSupplierAddressSchema,
} from "./supplier.schema.js";
import { supplierError } from "./supplier.errors.js";

export interface SupplierActor { empresaId: bigint; userId: bigint }
type Tx = Prisma.TransactionClient;
type CreateSupplier = z.infer<typeof createSupplierSchema>;
type UpdateSupplier = z.infer<typeof updateSupplierSchema>;
type SupplierList = z.infer<typeof supplierListSchema>;
type CreateAddress = z.infer<typeof createSupplierAddressSchema>;
type UpdateAddress = z.infer<typeof updateSupplierAddressSchema>;

async function findSupplier(tx: Tx, actor: SupplierActor, supplierId: bigint) {
  const record = await tx.proveedor.findFirst({
    where: { id: supplierId, empresa_id: actor.empresaId },
    include: { proveedor_direccion: { orderBy: { id: "asc" } } },
  });
  if (!record) throw supplierError.notFound();
  return record;
}


async function lockSupplier(tx: Tx, actor: SupplierActor, supplierId: bigint) {
  const rows = await tx.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM "pos"."proveedor"
    WHERE id = ${supplierId} AND empresa_id = ${actor.empresaId}
    FOR UPDATE
  `;
  if (rows.length === 0) throw supplierError.notFound();
  return findSupplier(tx, actor, supplierId);
}

async function findAddress(tx: Tx, supplierId: bigint, addressId: bigint) {
  const record = await tx.proveedor_direccion.findFirst({
    where: { id: addressId, proveedor_id: supplierId },
  });
  if (!record) throw supplierError.notFound();
  return record;
}

async function audit(
  tx: Tx, actor: SupplierActor, table: string, recordId: bigint,
  action: "INSERT" | "UPDATE" | "DELETE", changes: Record<string, string | number | boolean | null>,
) {
  await tx.auditoria.create({
    data: {
      usuario_id: actor.userId,
      tabla: table,
      registro_id: recordId,
      accion: action,
      datos_nuevos: changes,
    },
  });
}

export const supplierService = {
  async list(actor: SupplierActor, input: SupplierList) {
    const filter = input.q?.trim();
    const where: Prisma.proveedorWhereInput = {
      empresa_id: actor.empresaId,
      ...(input.activo === undefined ? {} : { activo: input.activo === "true" }),
      ...(filter ? {
        OR: [
          { codigo: { contains: filter, mode: "insensitive" } },
          { razon_social: { contains: filter, mode: "insensitive" } },
          { nombre_comercial: { contains: filter, mode: "insensitive" } },
          { rfc: { contains: filter, mode: "insensitive" } },
          { contacto: { contains: filter, mode: "insensitive" } },
          { email: { contains: filter, mode: "insensitive" } },
          { telefono: { contains: filter, mode: "insensitive" } },
        ],
      } : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.proveedor.findMany({
        where,
        orderBy: [{ razon_social: "asc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      prisma.proveedor.count({ where }),
    ]);
    return { items, total, page: input.page, pageSize: input.pageSize };
  },

  async get(actor: SupplierActor, supplierId: bigint) {
    return findSupplier(prisma, actor, supplierId);
  },

  async create(actor: SupplierActor, input: CreateSupplier) {
    return prisma.$transaction(async (tx) => {
      const duplicate = await tx.proveedor.findFirst({
        where: { empresa_id: actor.empresaId, codigo: input.codigo },
        select: { id: true },
      });
      if (duplicate) throw supplierError.conflict("Ya existe un proveedor con ese código en la empresa.");
      const record = await tx.proveedor.create({
        data: {
          empresa_id: actor.empresaId,
          codigo: input.codigo,
          razon_social: input.razon_social,
          nombre_comercial: input.nombre_comercial ?? null,
          rfc: input.rfc ?? null,
          email: input.email ?? null,
          telefono: input.telefono ?? null,
          contacto: input.contacto ?? null,
          dias_credito: input.dias_credito ?? 0,
          activo: input.activo ?? true,
        },
      });
      await audit(tx, actor, "proveedor", record.id, "INSERT", {
        empresa_id: String(actor.empresaId), codigo: record.codigo, razon_social: record.razon_social,
      });
      return record;
    });
  },

  async update(actor: SupplierActor, supplierId: bigint, input: UpdateSupplier) {
    return prisma.$transaction(async (tx) => {
      const before = await lockSupplier(tx, actor, supplierId);
      const record = await tx.proveedor.update({
        where: { id: supplierId },
        data: { ...input, actualizado_en: new Date() },
      });
      await audit(tx, actor, "proveedor", record.id, "UPDATE", {
        codigo_anterior: before.codigo,
        codigo_nuevo: record.codigo,
        activo_anterior: before.activo,
        activo_nuevo: record.activo,
        dias_credito_anterior: before.dias_credito,
        dias_credito_nuevo: record.dias_credito,
      });
      return record;
    });
  },

  async addresses(actor: SupplierActor, supplierId: bigint) {
    const record = await findSupplier(prisma, actor, supplierId);
    return record.proveedor_direccion;
  },

  async createAddress(actor: SupplierActor, supplierId: bigint, input: CreateAddress) {
    return prisma.$transaction(async (tx) => {
      await lockSupplier(tx, actor, supplierId);
      const count = await tx.proveedor_direccion.count({ where: { proveedor_id: supplierId } });
      if (count === 0 && input.es_principal === false) {
        throw supplierError.conflict("La primera dirección debe ser principal.");
      }
      const main = input.es_principal ?? (count === 0);
      if (main) {
        await tx.proveedor_direccion.updateMany({
          where: { proveedor_id: supplierId, es_principal: true }, data: { es_principal: false },
        });
      }
      const address = await tx.proveedor_direccion.create({
        data: {
          ...input,
          proveedor_id: supplierId,
          es_principal: main,
          pais: input.pais ?? "México",
        },
      });
      await audit(tx, actor, "proveedor_direccion", address.id, "INSERT", {
        proveedor_id: String(supplierId), tipo: address.tipo, es_principal: address.es_principal,
      });
      return address;
    });
  },

  async updateAddress(actor: SupplierActor, supplierId: bigint, addressId: bigint, input: UpdateAddress) {
    return prisma.$transaction(async (tx) => {
      await lockSupplier(tx, actor, supplierId);
      const previous = await findAddress(tx, supplierId, addressId);
      if (previous.es_principal && input.es_principal === false) {
        throw supplierError.conflict("Para sustituir la dirección principal, designe otra como principal.");
      }
      if (input.es_principal === true) {
        await tx.proveedor_direccion.updateMany({
          where: { proveedor_id: supplierId, es_principal: true }, data: { es_principal: false },
        });
      }
      const updated = await tx.proveedor_direccion.update({ where: { id: addressId }, data: input });
      await audit(tx, actor, "proveedor_direccion", addressId, "UPDATE", {
        proveedor_id: String(supplierId), tipo: updated.tipo, es_principal: updated.es_principal,
      });
      return updated;
    });
  },

  async deleteAddress(actor: SupplierActor, supplierId: bigint, addressId: bigint) {
    return prisma.$transaction(async (tx) => {
      await lockSupplier(tx, actor, supplierId);
      const previous = await findAddress(tx, supplierId, addressId);
      if (previous.es_principal) {
        const others = await tx.proveedor_direccion.count({
          where: { proveedor_id: supplierId, id: { not: addressId } },
        });
        if (others > 0) {
          throw supplierError.conflict("Designe otra dirección principal antes de eliminar esta dirección.");
        }
      }
      await tx.proveedor_direccion.delete({ where: { id: addressId } });
      await audit(tx, actor, "proveedor_direccion", addressId, "DELETE", {
        proveedor_id: String(supplierId), tipo: previous.tipo,
      });
      return { id: String(addressId), eliminado: true };
    });
  },
};
