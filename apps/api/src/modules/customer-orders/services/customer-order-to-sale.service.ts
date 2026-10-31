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
import {
  InsufficientStockError, SaleContextError, SalePaymentMethodError,
  SalePaymentTotalMismatchError,
} from '../../sales/errors/sale.errors.js';
import { customerOrderErrors, translateCustomerOrderDatabaseError } from '../errors/customer-order.errors.js';
import type { CustomerOrderActor, CustomerOrderTx } from '../types/customer-order.types.js';
import type { CustomerOrderConvertToSale } from '../customer-order-conversion.schema.js';
import { customerOrderIsConvertible, verifyCustomerOrderMoney } from '../utils/customer-order-sale-values.js';

const D = Prisma.Decimal;

/** La conversión completa usa una única transacción y el mismo motor de Ventas que M11. */
export async function convertCustomerOrderToSale(
  actor: CustomerOrderActor, orderId: bigint, request: CustomerOrderConvertToSale,
): Promise<unknown> {
  try {
    return await prisma.$transaction(async (tx: CustomerOrderTx) => {
      const user = await tx.usuario.findFirst({
        where: { id: actor.userId, empresa_id: actor.empresaId,
          activo: true, bloqueado: false, empresa: { activo: true } },
        select: { id: true },
      });
      if (!user) throw customerOrderErrors.forbidden();

      // Serializa conversiones y transiciones sobre el mismo pedido.
      const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
        SELECT id FROM pos.pedido_cliente
        WHERE id = ${orderId} AND empresa_id = ${actor.empresaId} FOR UPDATE
      `;
      if (locked.length !== 1) throw customerOrderErrors.notFound();
      const order = await tx.pedido_cliente.findFirst({
        where: { id: orderId, empresa_id: actor.empresaId },
        include: { pedido_cliente_detalle: { orderBy: { id: 'asc' } } },
      });
      if (!order) throw customerOrderErrors.notFound();
      const assignment = await tx.usuario_sucursal.findUnique({
        where: { usuario_id_sucursal_id: { usuario_id: actor.userId, sucursal_id: order.sucursal_id } },
        select: { usuario_id: true },
      });
      if (!assignment) throw customerOrderErrors.notFound();
      if (order.estado !== 'LISTO') {
        throw customerOrderErrors.conflict('El pedido debe estar LISTO para convertirse a venta.');
      }
      // No hay unicidad en DB: comprobar siempre bajo bloqueo; no habilitar parciales.
      const existing = await tx.venta.findFirst({
        where: { pedido_cliente_id: order.id }, select: { id: true },
      });
      if (!customerOrderIsConvertible(order.estado, existing ? 1 : 0)) {
        throw customerOrderErrors.conflict('El pedido ya tiene una venta asociada; no se admiten ventas parciales.');
      }
      if (!verifyCustomerOrderMoney(order.pedido_cliente_detalle, order)) {
        throw customerOrderErrors.conflict('Los importes históricos del pedido no coinciden con sus partidas.');
      }

      const saleInput: CreateSaleInput = {
        empresaId: actor.empresaId, sucursalId: order.sucursal_id,
        almacenId: request.almacen_id, clienteId: order.cliente_id,
        usuarioId: actor.userId, sesionCajaId: request.sesion_caja_id ?? null,
        folio: request.folio, observaciones: request.observaciones ?? order.observaciones,
        detalles: [],
        pagos: request.pagos.map(payment => ({
          metodoPagoId: payment.metodo_pago_id, monto: Number(payment.monto),
          referencia: payment.referencia ?? null,
        })),
      };
      await validateSaleContext(tx, saleInput);
      const { preparedPayments, condicionPago } = await prepareSalePayments(tx, saleInput);
      const sumPaid = request.pagos.reduce((sum, payment) => sum.plus(payment.monto), new D(0));
      if (!sumPaid.eq(order.total)) {
        throw customerOrderErrors.invalid('Los pagos no coinciden con el total histórico del pedido.');
      }
      if (preparedPayments.length !== request.pagos.length || preparedPayments.some((payment, i) =>
        !new D(payment.monto).eq(request.pagos[i]!.monto))) {
        throw customerOrderErrors.invalid('La conversión numérica del pago perdió precisión.');
      }

      const preparedDetails: PreparedSaleDetail[] = [];
      const requiredStock: RequiredStock[] = [];
      for (const line of order.pedido_cliente_detalle) {
        const product = await saleInventoryRepository.findProduct(tx, actor.empresaId, line.producto_id);
        if (!product) throw customerOrderErrors.invalid('Producto inexistente, inactivo o de otra empresa.');
        if (!product.unidad_medida.permite_decimales && !line.cantidad.isInteger()) {
          throw customerOrderErrors.invalid('La cantidad histórica no es válida para la unidad del producto.');
        }
        if (product.controla_inventario && !line.cantidad.isInteger()) {
          throw customerOrderErrors.invalid('Ecommerce no admite cantidades fraccionarias de inventario.');
        }
        const quantity = Number(line.cantidad);
        if (!Number.isFinite(quantity) || !new D(quantity).eq(line.cantidad)
          || !Number.isSafeInteger(quantity * 1000)) {
          throw customerOrderErrors.invalid('Cantidad del pedido fuera de la precisión segura de Ventas.');
        }
        if (product.controla_inventario && quantity > 2147483647) {
          throw customerOrderErrors.invalid('Cantidad fuera del rango INT de sincronización Ecommerce.');
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
        };
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
      if (!Object.values(totals).every(Number.isFinite)) {
        throw customerOrderErrors.invalid('Total del pedido fuera del rango de Ventas.');
      }
      validateSalePaymentTotal(preparedPayments, totals.total);

      const result = await persistCompletedSale({
        tx, input: saleInput, preparedDetails, preparedPayments,
        condicionPago, totals, pedidoClienteId: order.id,
      });
      const saved = await tx.venta.findUnique({
        where: { id: BigInt(result.id) },
        include: { venta_detalle: { orderBy: { id: 'asc' } } },
      });
      if (!saved || saved.pedido_cliente_id !== order.id || saved.orden_venta_id !== null
        || saved.cotizacion_id !== null || saved.estado !== 'COMPLETADA'
        || saved.empresa_id !== order.empresa_id || saved.sucursal_id !== order.sucursal_id
        || saved.cliente_id !== order.cliente_id
        || saved.venta_detalle.length !== order.pedido_cliente_detalle.length
        || !saved.subtotal.eq(order.subtotal) || !saved.descuento.eq(order.descuento)
        || !saved.impuesto.eq(order.impuesto) || !saved.total.eq(order.total)) {
        throw customerOrderErrors.conflict('Venta inconsistente con el pedido; transacción revertida.');
      }
      for (let i = 0; i < saved.venta_detalle.length; i++) {
        const current = saved.venta_detalle[i]!;
        const original = order.pedido_cliente_detalle[i]!;
        if (current.producto_id !== original.producto_id
          || !current.cantidad.eq(original.cantidad)
          || !current.precio_unitario.eq(original.precio_unitario)
          || !current.descuento_porcentaje.eq(original.descuento_porcentaje)
          || !current.tasa_impuesto.eq(original.tasa_impuesto)
          || !current.subtotal_linea.eq(original.subtotal_linea)
          || !current.descuento_importe.eq(original.descuento_importe)
          || !current.impuesto_importe.eq(original.impuesto_importe)
          || !current.total_linea.eq(original.total_linea)) {
          throw customerOrderErrors.conflict('Partidas históricas alteradas; transacción revertida.');
        }
      }
      await tx.auditoria.create({ data: {
        usuario_id: actor.userId, tabla: 'pedido_cliente', registro_id: order.id,
        accion: 'UPDATE', datos_nuevos: {
          modulo: 'PEDIDOS', accion: 'CONVERTIDO_A_VENTA', venta_id: saved.id.toString(),
        },
      } });
      // No marcar FACTURADO ni ENTREGADO: pendientes de reglas fiscales y de entrega.
      return { ...result, pedido_cliente_id: order.id.toString() };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10000, timeout: 30000,
    });
  } catch (error: unknown) {
    if (error instanceof InsufficientStockError) throw customerOrderErrors.invalid(error.message);
    if (error instanceof SaleContextError || error instanceof SalePaymentMethodError
      || error instanceof SalePaymentTotalMismatchError) {
      throw customerOrderErrors.invalid(error.message);
    }
    // La versión actual de ventas puede usar una clase específica para crédito sin cliente.
    if (error instanceof Error && error.name === 'SaleCreditRequiresClientError') {
      throw customerOrderErrors.invalid(error.message);
    }
    throw translateCustomerOrderDatabaseError(error);
  }
}
