import { useSyncExternalStore } from 'react'

import {
  getAuthSession,
  subscribeAuthSession,
} from './auth.session'

import type { AuthSession } from './auth.session'

export function useAuthSession(): AuthSession | null {
  return useSyncExternalStore(
    subscribeAuthSession,
    getAuthSession,
    () => null,
  )
}
