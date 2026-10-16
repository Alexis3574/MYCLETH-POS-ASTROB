import type { TransferRecord, TransferSummaryRecord } from "../repositories/transfer.repository.js";
import type { transferMovementRepository } from "../repositories/transfer-movement.repository.js";
import { stockState } from "../../inventory/utils/inventory.serializer.js";

export { stockState };

function warehouse(row: TransferSummaryRecord["almacen_transferencia_almacen_almacen_origen_idToalmacen"]) {
  return { id: row.id.toString(), codigo: row.codigo, nombre: row.nombre, activo: row.activo,
    sucursal: { id: row.sucursal.id.toString(), codigo: row.sucursal.codigo, nombre: row.sucursal.nombre,
      activo: row.sucursal.activo, empresa_id: row.sucursal.empresa_id.toString() } };
}

export function serializeTransferSummary(row: TransferSummaryRecord) {
  return { id: row.id.toString(), empresa_id: row.empresa_id.toString(), usuario_id: row.usuario_id.toString(),
    folio: row.folio, estado: row.estado, fecha: row.fecha.toISOString(), observaciones: row.observaciones,
    almacen_origen: warehouse(row.almacen_transferencia_almacen_almacen_origen_idToalmacen),
    almacen_destino: warehouse(row.almacen_transferencia_almacen_almacen_destino_idToalmacen),
    total_productos: row._count.transferencia_detalle, creado_en: row.creado_en.toISOString(), actualizado_en: row.actualizado_en.toISOString() };
}

export function serializeTransfer(row: TransferRecord) {
  return { ...serializeTransferSummary(row), detalles: row.transferencia_detalle.map((item) => ({
    id: item.id.toString(), producto_id: item.producto_id.toString(), cantidad: item.cantidad.toFixed(3),
    producto: { id: item.producto.id.toString(), sku: item.producto.sku, codigo_barras: item.producto.codigo_barras,
      nombre: item.producto.nombre, activo: item.producto.activo,
      unidad: { ...item.producto.unidad_medida, id: item.producto.unidad_medida.id.toString() } },
  })) };
}

export function serializeTransferMovements(rows: Awaited<ReturnType<typeof transferMovementRepository.list>>) {
  return rows.map((row) => ({ id: row.id.toString(), producto_id: row.producto_id.toString(), almacen_id: row.almacen_id.toString(),
    tipo: row.tipo, cantidad: row.cantidad.toFixed(3), costo_unitario: row.costo_unitario?.toFixed(4) ?? null,
    documento_detalle_id: row.documento_detalle_id?.toString() ?? null, fecha: row.fecha.toISOString() }));
}
