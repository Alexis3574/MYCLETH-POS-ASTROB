import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import type { TransferTransaction } from "../../../src/modules/transfers/types/transfer.types.js";

export async function testRuntime() {
  dotenv.config({ quiet: true });
  const url = process.env.TRANSFERS_TEST_DATABASE_URL;
  if (!url || process.env.TRANSFERS_ALLOW_DB_TESTS !== "true") throw new Error("Las pruebas de base requieren una conexión de pruebas y habilitación explícita.");
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/(?:^|[_-])test(?:s|ing)?(?:$|[_-])/i.test(name)) throw new Error("El nombre de la base debe identificar un entorno de pruebas.");
  process.env.DATABASE_URL = url;
  const { prisma } = await import("../../../src/lib/prisma.js");
  const services = await import("../../../src/modules/transfers/services/transfer-write.service.js");
  return { prisma, ...services };
}

export async function createFixture(tx: TransferTransaction, tag = randomUUID()) {
  const permission = await tx.permiso.findUnique({ where: { codigo: "INVENTARIO.TRANSFERIR" } });
  if (!permission) throw new Error("La base de pruebas debe tener el permiso INVENTARIO.TRANSFERIR.");
  const unit = await tx.unidad_medida.create({ data: { codigo: `TR-${tag.slice(0, 12)}`, nombre: "Unidad de pruebas de Transferencias", permite_decimales: true } });
  const company = await tx.empresa.create({ data: { razon_social: `TRANSFERS_TEST_${tag}`, nombre_comercial: "Pruebas de Transferencias" } });
  const branch = await tx.sucursal.create({ data: { empresa_id: company.id, codigo: "TEST", nombre: "Sucursal de pruebas" } });
  const origin = await tx.almacen.create({ data: { sucursal_id: branch.id, codigo: "ORIGEN", nombre: "Origen de pruebas" } });
  const destination = await tx.almacen.create({ data: { sucursal_id: branch.id, codigo: "DESTINO", nombre: "Destino de pruebas" } });
  const user = await tx.usuario.create({ data: { empresa_id: company.id, username: `tr-${tag}`, password_hash: "TEST_ONLY_NO_LOGIN", nombre: "Usuario de pruebas" } });
  const role = await tx.rol.create({ data: { codigo: `TR-${tag}`, nombre: "Rol de pruebas", rol_permiso: { create: { permiso_id: permission.id } } } });
  await tx.usuario_rol.create({ data: { usuario_id: user.id, rol_id: role.id } });
  const products: bigint[] = [];
  for (const number of [1, 2]) {
    const product = await tx.producto.create({ data: { empresa_id: company.id, unidad_medida_id: unit.id,
      sku: `TR-${tag}-${number}`, nombre: `Producto de pruebas ${number}`, controla_inventario: true } });
    products.push(product.id);
    await tx.movimiento_inventario.create({ data: { producto_id: product.id, almacen_id: origin.id, usuario_id: user.id,
      tipo: "AJUSTE_POSITIVO", cantidad: "10.000", costo_unitario: "12.5000", documento_tipo: "PRUEBA_TRANSFERENCIAS" } });
    await tx.movimiento_inventario.create({ data: { producto_id: product.id, almacen_id: destination.id, usuario_id: user.id,
      tipo: "AJUSTE_POSITIVO", cantidad: "2.000", costo_unitario: "30.0000", documento_tipo: "PRUEBA_TRANSFERENCIAS" } });
    await tx.existencia.update({ where: { producto_id_almacen_id: { producto_id: product.id, almacen_id: origin.id } }, data: { reservado: "4.000" } });
  }
  return { tag, actor: { empresaId: company.id, userId: user.id }, originId: origin.id, destinationId: destination.id,
    products, unitId: unit.id, roleId: role.id };
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;

export async function deleteFixture(tx: TransferTransaction, fixture: Fixture) {
  const companyId = fixture.actor.empresaId;
  await tx.auditoria.deleteMany({ where: { usuario_id: fixture.actor.userId } });
  await tx.sincronizacion_ecommerce_inventario.deleteMany({ where: { movimiento_inventario: { producto_id: { in: fixture.products } } } });
  await tx.operacion_transferencia.deleteMany({ where: { empresa_id: companyId } });
  await tx.transferencia_almacen.deleteMany({ where: { empresa_id: companyId } });
  await tx.movimiento_inventario.deleteMany({ where: { producto_id: { in: fixture.products } } });
  await tx.existencia.deleteMany({ where: { producto_id: { in: fixture.products } } });
  await tx.producto.deleteMany({ where: { empresa_id: companyId } });
  await tx.almacen.deleteMany({ where: { sucursal: { empresa_id: companyId } } });
  await tx.usuario_rol.deleteMany({ where: { usuario_id: fixture.actor.userId } });
  await tx.usuario.deleteMany({ where: { empresa_id: companyId } });
  await tx.sucursal.deleteMany({ where: { empresa_id: companyId } });
  await tx.empresa.delete({ where: { id: companyId } });
  await tx.rol.delete({ where: { id: fixture.roleId } });
  await tx.unidad_medida.delete({ where: { id: fixture.unitId } });
}
