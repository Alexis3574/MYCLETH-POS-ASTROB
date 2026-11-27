import type { CashSessionRecord } from './cash.types'
import type { Page } from '../commercial/commercial.types'

// Una primera página sin coincidencias no prueba que una operación no exista.
export async function allCashRows<T extends { id: string }>(load: (page: number) => Promise<Page<T>>) {
  const rows: T[] = [], ids = new Set<string>()
  let expectedTotal: number | null = null
  for (let page = 1; page <= 500; page++) {
    const data = await load(page)
    if (expectedTotal !== null && data.total !== expectedTotal) throw new Error('El historial cambió durante la revisión. Consulta de nuevo.')
    expectedTotal = data.total
    for (const row of data.items) {
      if (ids.has(row.id)) throw new Error('El historial cambió durante la revisión. Consulta de nuevo.')
      ids.add(row.id); rows.push(row)
    }
    if (rows.length === data.total) return rows
    if (!data.items.length || rows.length > data.total) break
  }
  throw new Error('No se pudo revisar el historial completo. Solicita una revisión antes de repetir la operación.')
}
export function latestCashSessionId(rows: CashSessionRecord[]) { return rows.reduce((max, row) => BigInt(row.id) > BigInt(max) ? row.id : max, '0') }
