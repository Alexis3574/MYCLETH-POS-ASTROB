import { createHash } from 'node:crypto';
import type { CreateSaleInput, SaleTransaction } from '../../types/sales.types.js';

export class SaleOperationConflict extends Error {
  readonly code = 'SALE_IDEMPOTENCY_CONFLICT';
  constructor() { super('El identificador del intento ya pertenece a otra solicitud o usuario.'); }
}

// Se excluye la IP: un reintento puede llegar por otra conexión. Orden fijo y valores ya validados.
export function saleRequestHash(input: CreateSaleInput) {
  return createHash('sha256').update(JSON.stringify({
    empresa: String(input.empresaId), sucursal: String(input.sucursalId), almacen: String(input.almacenId),
    cliente: input.clienteId == null ? null : String(input.clienteId), usuario: String(input.usuarioId),
    caja: input.sesionCajaId == null ? null : String(input.sesionCajaId), folio: input.folio,
    observaciones: input.observaciones ?? null,
    detalles: input.detalles.map(d => [String(d.productoId), d.descripcion ?? null, d.cantidad, d.descuentoPorcentaje]),
    pagos: input.pagos.map(p => [String(p.metodoPagoId), p.monto, p.referencia ?? null]),
  })).digest('hex');
}

export function formatSaleFolio(branch: bigint, period: string, sequence: bigint) {
  if (branch <= 0n || !/^\d{8}$/.test(period) || sequence <= 0n) throw new Error('Secuencia de folio no válida.');
  const folio = 'VTA-' + branch + '-' + period + '-' + String(sequence).padStart(6, '0');
  if (folio.length > 50) throw new Error('Se agotó la longitud del folio.');
  return folio;
}

export async function nextSaleFolio(tx: SaleTransaction, input: CreateSaleInput) {
  const [{ periodo }] = await tx.$queryRaw<{ periodo: string }[]>`SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYYMMDD') AS periodo`;
  // Un folio explícito antiguo puede ocupar el mismo formato; nunca se renumera ni sobrescribe.
  for (let attempt = 0; attempt < 1000; attempt++) {
    const [row] = await tx.$queryRaw<{ ultimo: bigint }[]>`
      INSERT INTO pos.folio_documento (empresa_id, sucursal_id, tipo, periodo, ultimo)
      VALUES (${input.empresaId}, ${input.sucursalId}, 'VENTA', ${periodo}, 1)
      ON CONFLICT (empresa_id, sucursal_id, tipo, periodo)
      DO UPDATE SET ultimo = pos.folio_documento.ultimo + 1 RETURNING ultimo`;
    const folio = formatSaleFolio(input.sucursalId, periodo, row.ultimo);
    if (!await tx.venta.findFirst({ where: { sucursal_id: input.sucursalId, folio }, select: { id: true } })) return folio;
  }
  throw new Error('No se pudo asignar un folio libre. Requiere revisión administrativa.');
}

export interface StoredOperation { usuario_id: bigint; sucursal_id: bigint; request_hash: string; respuesta: unknown }
export async function findSaleOperation(tx: SaleTransaction, company: bigint, key: string) {
  const rows = await tx.$queryRaw<StoredOperation[]>`
    SELECT usuario_id, sucursal_id, request_hash, respuesta FROM pos.operacion_venta
    WHERE empresa_id = ${company} AND clave_idempotencia = ${key}::uuid`;
  return rows[0] ?? null;
}

export async function replaySale(tx: SaleTransaction, input: CreateSaleInput) {
  if (!input.claveIdempotencia) return null;
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'pos-sale:' + input.empresaId + ':' + input.claveIdempotencia}, 0))`;
  const previous = await findSaleOperation(tx, input.empresaId, input.claveIdempotencia);
  if (!previous) return null;
  if (previous.usuario_id !== input.usuarioId || previous.request_hash !== saleRequestHash(input)) throw new SaleOperationConflict();
  return previous.respuesta;
}

export async function storeSaleOperation(tx: SaleTransaction, input: CreateSaleInput, response: { id: string }) {
  if (!input.claveIdempotencia) return;
  await tx.$executeRaw`
    INSERT INTO pos.operacion_venta (empresa_id, usuario_id, sucursal_id, clave_idempotencia, venta_id, request_hash, respuesta)
    VALUES (${input.empresaId}, ${input.usuarioId}, ${input.sucursalId}, ${input.claveIdempotencia}::uuid,
      ${BigInt(response.id)}, ${saleRequestHash(input)}, ${JSON.stringify(response)}::jsonb)`;
}
