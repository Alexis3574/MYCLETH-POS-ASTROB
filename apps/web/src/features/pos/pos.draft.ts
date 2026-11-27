import type { CartLine, Customer, DraftPayment, PaymentMethod, Warehouse } from '../commercial/commercial.types.ts'

export interface PosDraft {
  warehouse: Warehouse | null; customer: Customer | null; folio: string; notes: string
  lines: CartLine[]; payments: DraftPayment[]; methods: PaymentMethod[]
}
function emptyDraft(): PosDraft { return { warehouse: null, customer: null, folio: '', notes: '', lines: [], payments: [], methods: [] } }
const empty = emptyDraft()
export function createPosDraftStore() {
  let owner: string | null = null
  let draft = empty
  const listeners = new Set<() => void>()
  return {
    get(identity: string): PosDraft { return owner === identity ? draft : empty },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    update(identity: string, patch: Partial<PosDraft>) {
      draft = { ...(owner === identity ? draft : emptyDraft()), ...patch }
      owner = identity
      listeners.forEach((listener) => listener())
    },
    clear() { owner = null; draft = empty; listeners.forEach((listener) => listener()) },
  }
}
