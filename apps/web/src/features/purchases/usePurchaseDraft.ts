import { useSyncExternalStore } from 'react'
import { getAuthSession, subscribeAuthSession } from '../auth/auth.session'
import { useAuthSession } from '../auth/useAuthSession'
import { createPurchaseDraftStore } from './purchase.draft'
import type { PurchaseDraft } from './purchase.draft'
const store = createPurchaseDraftStore()
subscribeAuthSession(() => { if (!getAuthSession()) store.clear() })
export function usePurchaseDraft() {
  const auth = useAuthSession(), identity = auth ? auth.user.empresa.id + ':' + auth.user.id : ''
  const draft = useSyncExternalStore(store.subscribe, () => store.get(identity))
  return { draft, update: (patch: Partial<PurchaseDraft>) => store.update(identity, patch), clear: store.clear }
}
