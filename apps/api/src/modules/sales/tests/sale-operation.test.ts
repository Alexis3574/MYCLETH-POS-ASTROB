import assert from 'node:assert/strict';
import test from 'node:test';
import { createSaleSchema } from '../sale.schema.js';
import { formatSaleFolio, saleRequestHash, replaySale, nextSaleFolio, storeSaleOperation, SaleOperationConflict } from '../services/create/sale-operation.js';
import type { CreateSaleInput, SaleTransaction } from '../types/sales.types.js';

const key = '11111111-1111-4111-8111-111111111111';
function input(): CreateSaleInput { return { empresaId: 1n, sucursalId: 2n, almacenId: 1n, usuarioId: 3n, folio: '', claveIdempotencia: key,
  detalles: [{ productoId: 4n, cantidad: 1, descuentoPorcentaje: 0 }], pagos: [{ metodoPagoId: 1n, monto: 116 }] }; }
const body = { empresa_id: '1', sucursal_id: '2', almacen_id: '1', detalles: [{ producto_id: '4', cantidad: 1, descuento_porcentaje: 0 }], pagos: [{ metodo_pago_id: '1', monto: 116 }] };

test('contrato acepta folio explícito antiguo o automático protegido, nunca una captura sin ambos', () => {
  assert.equal(createSaleSchema.safeParse({ ...body, folio: 'LEGACY-001' }).success, true);
  assert.equal(createSaleSchema.safeParse({ ...body, clave_idempotencia: key }).success, true);
  assert.equal(createSaleSchema.safeParse(body).success, false);
  assert.equal(createSaleSchema.safeParse({ ...body, folio: '', clave_idempotencia: key }).success, false);
  assert.equal(createSaleSchema.safeParse({ ...body, clave_idempotencia: 'incorrecto' }).success, false);
});
test('folio comercial conserva BIGINT, crece después de seis dígitos y diferencia sucursal y periodo', () => {
  assert.equal(formatSaleFolio(2n, '20261119', 1n), 'VTA-2-20261119-000001');
  assert.equal(formatSaleFolio(9223372036854775807n, '20261119', 1000000n), 'VTA-9223372036854775807-20261119-1000000');
  assert.notEqual(formatSaleFolio(2n, '20261119', 1n), formatSaleFolio(3n, '20261119', 1n));
  assert.notEqual(formatSaleFolio(2n, '20261119', 1n), formatSaleFolio(2n, '20261120', 1n));
  assert.throws(() => formatSaleFolio(0n, '20261119', 1n));
});
test('huella estable ignora cambios de red y detecta cambios operativos y de actor', () => {
  const original = input();
  assert.equal(saleRequestHash(original), saleRequestHash({ ...original, ipOrigen: '192.0.2.1' }));
  for (const changed of [{ ...original, usuarioId: 5n }, { ...original, almacenId: 5n }, { ...original, folio: 'OTRO' },
    { ...original, pagos: [{ metodoPagoId: 1n, monto: 117 }] }]) assert.notEqual(saleRequestHash(original), saleRequestHash(changed));
});
test('reintento igual devuelve respuesta anterior; otra solicitud o usuario produce conflicto', async () => {
  const request = input(), response = { id: '99', folio: 'VTA-2-20261119-000001', total: 116 };
  let locked = false;
  const tx = { $queryRaw: async (sql: TemplateStringsArray) => {
    if (sql.join('').includes('pg_advisory_xact_lock')) { locked = true; return []; }
    assert.ok(locked);
    return [{ usuario_id: 3n, sucursal_id: 2n, request_hash: saleRequestHash(request), respuesta: response }];
  } } as unknown as SaleTransaction;
  assert.deepEqual(await replaySale(tx, request), response);
  await assert.rejects(replaySale(tx, { ...request, usuarioId: 7n }), SaleOperationConflict);
  await assert.rejects(replaySale(tx, { ...request, pagos: [{ metodoPagoId: 1n, monto: 117 }] }), SaleOperationConflict);
});
test('folio automático omite colisiones históricas usando contador atómico parametrizado', async () => {
  let counter = 0n;
  const tx = { $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
    if (sql.join('').includes('to_char')) return [{ periodo: '20261119' }];
    assert.ok(sql.join('').includes('ON CONFLICT')); assert.deepEqual(values, [1n, 2n, '20261119']);
    return [{ ultimo: ++counter }];
  }, venta: { findFirst: async () => counter === 1n ? { id: 1n } : null } } as unknown as SaleTransaction;
  assert.equal(await nextSaleFolio(tx, input()), 'VTA-2-20261119-000002');
});
test('compatibilidad sin clave no consulta tablas nuevas; persistencia incluye huella y resultado juntos', async () => {
  let saved: unknown[] = [];
  const tx = { $executeRaw: async (_sql: TemplateStringsArray, ...values: unknown[]) => { saved = values; } } as unknown as SaleTransaction;
  assert.equal(await replaySale(tx, { ...input(), claveIdempotencia: undefined }), null);
  await storeSaleOperation(tx, input(), { id: '99' });
  assert.deepEqual(saved.slice(0, 5), [1n, 3n, 2n, key, 99n]);
  assert.equal(saved[5], saleRequestHash(input())); assert.equal(saved[6], '{"id":"99"}');
});
