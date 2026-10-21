import type { PurchaseActor, PurchaseCreateInput, PurchaseTx } from '../types/purchase.types.js';
import { purchaseError } from '../errors/purchase.errors.js';
import { Prisma } from '../../../generated/prisma/client.js';

export async function validatePurchaseActor(tx: PurchaseTx, actor: PurchaseActor) {
  const user = await tx.usuario.findFirst({ where: {
    id: actor.userId, empresa_id: actor.empresaId, activo: true, bloqueado: false,
    empresa: { activo: true },
  }, select: { id: true } });
  if (!user) throw purchaseError.forbidden();
}

export async function validatePurchaseContext(tx: PurchaseTx, actor: PurchaseActor, input: PurchaseCreateInput) {
  const branch = await tx.sucursal.findFirst({ where: { id: input.sucursal_id, empresa_id: actor.empresaId, activo: true }, select: { id: true } });
  if (!branch) throw purchaseError.invalid('Sucursal inexistente, inactiva o ajena a la empresa.');
  const assignment = await tx.usuario_sucursal.findUnique({ where: { usuario_id_sucursal_id: { usuario_id: actor.userId, sucursal_id: branch.id } } });
  if (!assignment) throw purchaseError.invalid('Usuario sin asignación a esta sucursal.');
  const warehouse = await tx.almacen.findFirst({ where: { id: input.almacen_id, sucursal_id: branch.id, activo: true }, select: { id: true } });
  if (!warehouse) throw purchaseError.invalid('Almacén inexistente, inactivo o ajeno a la sucursal.');
  const supplier = await tx.proveedor.findFirst({ where: { id: input.proveedor_id, empresa_id: actor.empresaId, activo: true }, select: { id: true } });
  if (!supplier) throw purchaseError.invalid('Proveedor inexistente, inactivo o ajeno a la empresa.');
  const seen = new Set<string>();
  for (const item of input.detalles) {
    if (seen.has(item.producto_id.toString())) throw purchaseError.invalid('No se permiten productos repetidos en la misma compra.');
    seen.add(item.producto_id.toString());
    const product = await tx.producto.findFirst({ where: { id: item.producto_id, empresa_id: actor.empresaId, activo: true },
      include: { unidad_medida: true } });
    if (!product || !product.unidad_medida.activo) throw purchaseError.invalid(`Producto no disponible: ${item.producto_id}.`);
    if (!product.unidad_medida.permite_decimales && !new Prisma.Decimal(item.cantidad).isInteger()) {
      throw purchaseError.invalid(`El producto ${product.sku} requiere cantidades enteras.`);
    }
    if (product.controla_inventario) {
      if (product.tipo !== 'PRODUCTO') throw purchaseError.invalid(`El producto ${product.sku} tiene un tipo incompatible con inventario.`);
      if (!new Prisma.Decimal(item.cantidad).isInteger() || new Prisma.Decimal(item.cantidad).gt('2147483647')) {
        throw purchaseError.invalid(`El producto ${product.sku} exige cantidad entera compatible con Ecommerce.`);
      }
      if (!product.codigo_barras) throw purchaseError.invalid(`El producto inventariable ${product.sku} necesita código de barras para Ecommerce.`);
    }
  }
}

export async function validatePurchaseCurrentContext(tx: PurchaseTx, actor: PurchaseActor, row: {
  sucursal_id: bigint; almacen_id: bigint; proveedor_id: bigint;
  compra_detalle: Array<{ producto_id: bigint; cantidad: Prisma.Decimal; producto: {
    empresa_id: bigint; activo: boolean; tipo: string; controla_inventario: boolean; codigo_barras: string | null;
    unidad_medida: { permite_decimales: boolean; activo: boolean };
  } }>;
}) {
  const branch = await tx.sucursal.findFirst({ where: { id: row.sucursal_id, empresa_id: actor.empresaId, activo: true } });
  const assignment = branch && await tx.usuario_sucursal.findUnique({ where: { usuario_id_sucursal_id: { usuario_id: actor.userId, sucursal_id: row.sucursal_id } } });
  const warehouse = branch && await tx.almacen.findFirst({ where: { id: row.almacen_id, sucursal_id: row.sucursal_id, activo: true } });
  const supplier = await tx.proveedor.findFirst({ where: { id: row.proveedor_id, empresa_id: actor.empresaId, activo: true } });
  if (!branch || !assignment || !warehouse || !supplier) throw purchaseError.invalid('La empresa, sucursal, almacén, proveedor o asignación ya no son válidos.');
  if (!row.compra_detalle.length) throw purchaseError.invalid('La compra no contiene detalles.');
  const ids = new Set<string>();
  for (const item of row.compra_detalle) {
    const product = item.producto;
    if (ids.has(item.producto_id.toString())) throw purchaseError.invalid('La compra contiene detalles duplicados del mismo producto.');
    ids.add(item.producto_id.toString());
    if (product.empresa_id !== actor.empresaId || !product.activo || !product.unidad_medida.activo) {
      throw purchaseError.invalid('Producto inactivo o de empresa incorrecta.');
    }
    if (!product.unidad_medida.permite_decimales && !item.cantidad.isInteger()) throw purchaseError.invalid('Cantidad incompatible con la unidad.');
    if (product.controla_inventario && (product.tipo !== 'PRODUCTO' || !product.codigo_barras || !item.cantidad.isInteger() || item.cantidad.gt('2147483647'))) {
      throw purchaseError.invalid('Producto inventariable incompatible con la sincronización Ecommerce.');
    }
  }
}
