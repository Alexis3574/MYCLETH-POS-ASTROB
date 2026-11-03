import { Prisma } from '../../../generated/prisma/client.js';
import { prisma } from '../../../lib/prisma.js';
import { persistCompletedSale } from '../../sales/services/create/sale-persistence.service.js';
import { validateSaleContext } from '../../sales/services/create/sale-context.validator.js';
import { prepareSalePayments } from '../../sales/services/create/sale-payment.preparer.js';
import { validateSaleStock } from '../../sales/services/create/sale-stock.validator.js';
import { validateSalePaymentTotal } from '../../sales/services/create/sale-totals.js';
import { saleInventoryRepository } from '../../sales/repositories/sale-inventory.repository.js';
import type { PreparedSaleDetail, RequiredStock } from '../../sales/services/create/sale-detail.preparer.js';
import type { CreateSaleInput } from '../../sales/types/sales.types.js';
import { orderErrors, translateOrderDatabaseError } from '../errors/order.errors.js';
import type { OrderActor, OrderTx } from '../types/order.types.js';
import type { OrderConvertToSale } from '../order-conversion.schema.js';
import { checkOrderLineIntegrity, sumMoney } from '../utils/order-sale-values.js';

const D = Prisma.Decimal;

function equality(a: Prisma.Decimal, b: Prisma.Decimal): boolean { return a.eq(b); }

export async function convertOrderToSale(
  actor: OrderActor, orderId: bigint, request: OrderConvertToSale,
): Promise<unknown> {
  try {
    return await prisma.$transaction(async (tx: OrderTx) => {
      const user = await tx.usuario.findFirst({
        where: { id: actor.userId, empresa_id: actor.empresaId,
          activo: true, bloqueado: false, empresa: { activo: true } },
        select: { id: true },
      });
      if (!user) throw orderErrors.forbidden();

      const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM pos.orden_venta
        WHERE id = ${orderId} AND empresa_id = ${actor.empresaId}
        FOR UPDATE
      `;
      if (rows.length !== 1) throw orderErrors.notFound();
      const order = await tx.orden_venta.findFirst({
        where: { id: orderId, empresa_id: actor.empresaId },
        include: { orden_venta_detalle: { orderBy: { id: 'asc' } } },
      });
      if (!order) throw orderErrors.notFound();

      const assigned = await tx.usuario_sucursal.findUnique({
        where: { usuario_id_sucursal_id: { usuario_id: actor.userId, sucursal_id: order.sucursal_id } },
        select: { usuario_id: true },
      });
      if (!assigned) throw orderErrors.notFound();
      if (order.estado !== 'LISTA') throw orderErrors.conflict('La orden debe estar LISTA para convertirse.');

      const already = await tx.venta.findFirst({
        where: { orden_venta_id: order.id }, select: { id: true },
      });
      if (already) throw orderErrors.conflict('La orden ya tiene una venta asociada.');
      if (order.orden_venta_detalle.length === 0) throw orderErrors.invalid('Orden sin partidas.');

      const saleInput: CreateSaleInput = {
        empresaId: actor.empresaId, sucursalId: order.sucursal_id,
        almacenId: request.almacen_id, usuarioId: actor.userId,
        clienteId: order.cliente_id, sesionCajaId: request.sesion_caja_id ?? null,
        folio: request.folio, observaciones: request.observaciones ?? order.observaciones,
        detalles: [],
        pagos: request.pagos.map(p => ({
          metodoPagoId: p.metodo_pago_id, monto: Number(p.monto), referencia: p.referencia ?? null,
        })),
      };

      await validateSaleContext(tx, saleInput);
      const { preparedPayments, condicionPago } = await prepareSalePayments(tx, saleInput);
      const amountPaid = request.pagos.reduce((sum, p) => sum.plus(p.monto), new D(0));
      if (!amountPaid.eq(order.total)) throw orderErrors.invalid('Los pagos no coinciden con el total histórico de la orden.');
      if (preparedPayments.some((payment, index) => !new D(payment.monto).eq(request.pagos[index]!.monto))) {
        throw orderErrors.invalid('La conversión numérica de un pago no conserva su precisión.');
      }

      const preparedDetails: PreparedSaleDetail[] = [];
      const requiredStock: RequiredStock[] = [];
      const detailAmounts = sumMoney(order.orden_venta_detalle);
      if (![equality(detailAmounts.subtotal, order.subtotal),
        equality(detailAmounts.descuento, order.descuento),
        equality(detailAmounts.impuesto, order.impuesto),
        equality(detailAmounts.total, order.total)].every(Boolean)) {
        throw orderErrors.conflict('Totales de orden inconsistentes con sus partidas.');
      }

      for (const line of order.orden_venta_detalle) {
        if (!checkOrderLineIntegrity(line)) throw orderErrors.conflict('La orden contiene importes históricos inconsistentes.');
        const product = await saleInventoryRepository.findProduct(tx, actor.empresaId, line.producto_id);
        if (!product) throw orderErrors.invalid('Producto inactivo, inexistente o ajeno a la empresa.');
        if (!product.unidad_medida.permite_decimales && !line.cantidad.isInteger()) {
          throw orderErrors.invalid('Cantidad decimal incompatible con la unidad del producto.');
        }
        if (product.controla_inventario && !line.cantidad.isInteger()) {
          throw orderErrors.invalid('Ecommerce requiere cantidades enteras para productos inventariables.');
        }
        const quantity = Number(line.cantidad);
        if (!Number.isFinite(quantity) || !new D(quantity).eq(line.cantidad)
          || !Number.isSafeInteger(quantity * 1000)) {
          throw orderErrors.invalid('Cantidad fuera de la precisión segura de Ventas.');
        }
        if (product.controla_inventario && quantity > 2147483647) {
          throw orderErrors.invalid('Cantidad excede INT de sincronización Ecommerce.');
        }
        const prepared: PreparedSaleDetail = {
          product, descripcion: line.descripcion ?? product.nombre,
          cantidad: quantity,
          precioUnitario: Number(line.precio_unitario),
          costoUnitario: Number(product.costo_referencia),
          descuentoPorcentaje: Number(line.descuento_porcentaje),
          tasaImpuesto: Number(line.tasa_impuesto),
          subtotalLinea: Number(line.subtotal_linea),
          descuentoImporte: Number(line.descuento_importe),
          impuestoImporte: Number(line.impuesto_importe),
          totalLinea: Number(line.total_linea),
        } as PreparedSaleDetail;
        preparedDetails.push(prepared);
        if (product.controla_inventario) requiredStock.push({
          productoId: product.id, sku: product.sku, quantity,
        });
      }


      requiredStock.sort((a, b) => a.productoId < b.productoId ? -1 : a.productoId > b.productoId ? 1 : 0);
      await validateSaleStock(tx, request.almacen_id, requiredStock);
      const totals = {
        subtotal: Number(order.subtotal), descuento: Number(order.descuento),
        impuesto: Number(order.impuesto), total: Number(order.total),
      };
      if (![totals.subtotal, totals.descuento, totals.impuesto, totals.total].every(Number.isFinite)) {
        throw orderErrors.invalid('Totales fuera de rango.');
      }
      validateSalePaymentTotal(preparedPayments, totals.total);

      const result = await persistCompletedSale({
        tx, input: saleInput, preparedDetails, preparedPayments,
        condicionPago, totals, ordenVentaId: order.id,
      });
      const saved = await tx.venta.findUnique({
        where: { id: BigInt(result.id) },
        include: { venta_detalle: { orderBy: { id: 'asc' } } },
      });
      if (!saved || saved.orden_venta_id !== order.id || saved.estado !== 'COMPLETADA'
        || saved.venta_detalle.length !== order.orden_venta_detalle.length
        || !saved.subtotal.eq(order.subtotal) || !saved.descuento.eq(order.descuento)
        || !saved.impuesto.eq(order.impuesto) || !saved.total.eq(order.total)) {
        throw orderErrors.conflict('La venta no conservó los totales históricos; transacción revertida.');
      }
      for (let i = 0; i < saved.venta_detalle.length; i++) {
        const current = saved.venta_detalle[i]!;
        const original = order.orden_venta_detalle[i]!;
        if (current.producto_id !== original.producto_id
          || !current.cantidad.eq(original.cantidad)
          || !current.precio_unitario.eq(original.precio_unitario)
          || !current.descuento_porcentaje.eq(original.descuento_porcentaje)
          || !current.tasa_impuesto.eq(original.tasa_impuesto)
          || !current.subtotal_linea.eq(original.subtotal_linea)
          || !current.descuento_importe.eq(original.descuento_importe)
          || !current.impuesto_importe.eq(original.impuesto_importe)
          || !current.total_linea.eq(original.total_linea)) {
          throw orderErrors.conflict('La venta no conservó las partidas originales; transacción revertida.');
        }
      }

      await tx.auditoria.create({ data: {
        usuario_id: actor.userId, tabla: 'orden_venta', registro_id: order.id,
        accion: 'UPDATE', datos_nuevos: {
          modulo: 'ORDENES', accion: 'CONVERTIDA_A_VENTA', venta_id: saved.id.toString(),
        },
      } });
      // Keep estado LISTA until FACTURADA is explicitly defined as a fiscal/business event.
      return { ...result, orden_venta_id: order.id.toString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10000, timeout: 30000 });
  } catch (error: unknown) {
    throw translateOrderDatabaseError(error);
  }
}
