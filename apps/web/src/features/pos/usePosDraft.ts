import { useCallback, useSyncExternalStore } from 'react'
import { getAuthSession, subscribeAuthSession } from '../auth/auth.session'
import { useAuthSession } from '../auth/useAuthSession'
import { createPosDraftStore } from './pos.draft'
import type { PosDraft } from './pos.draft'

// Borrador solo en memoria: se conserva entre rutas y se elimina al cerrar sesión.
// La selección de sesión de caja se mantiene fuera del borrador y debe verificarse al volver.
const store = createPosDraftStore()
subscribeAuthSession(() => { if (!getAuthSession()) store.clear() })
export function usePosDraft() {
  const session = useAuthSession()
  const identity = JSON.stringify([session?.user.empresa.id, session?.user.id, session?.expiresAt])
  const get = useCallback(() => store.get(identity), [identity])
  const draft = useSyncExternalStore(store.subscribe, get)
  const update = useCallback((patch: Partial<PosDraft>) => store.update(identity, patch), [identity])
  return { draft, update, clear: store.clear }
}
