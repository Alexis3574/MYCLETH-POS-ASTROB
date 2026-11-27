import { useEffect, useState } from 'react'
import { ApiHttpError } from '../services/api'
import { clearAuthSession, getAuthSession } from '../features/auth/auth.session'
import { useAuthSession } from '../features/auth/useAuthSession'

type Status = 'idle' | 'loading' | 'success' | 'forbidden' | 'not-found' | 'error'
interface Result<T> { key: string; status: Status; data: T | null; error: string | null }

export function useRemoteResource<T>(
  identity: string, enabled: boolean, load: (token: string, signal: AbortSignal) => Promise<T>,
) {
  const session = useAuthSession()
  const token = session?.accessToken ?? null
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<Result<T> | null>(null)
  const key = JSON.stringify([identity, token, enabled, revision])

  useEffect(() => {
    if (!enabled || !token) return
    const controller = new AbortController()
    load(token, controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult({ key, status: 'success', data, error: null })
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      if (cause instanceof ApiHttpError && cause.status === 401) {
        if (getAuthSession()?.accessToken === token) clearAuthSession()
        return
      }
      const status: Status = cause instanceof ApiHttpError
        ? cause.status === 403 ? 'forbidden' : cause.status === 404 ? 'not-found' : 'error'
        : 'error'
      setResult({ key, status, data: null, error: cause instanceof Error ? cause.message : 'No se pudo completar la consulta.' })
    })
    return () => controller.abort()
  }, [key, enabled, token, load])

  const current: Result<T> = !enabled || !token
    ? { key, status: 'idle', data: null, error: null }
    : result?.key === key ? result : { key, status: 'loading', data: null, error: null }
  return { ...current, refresh: () => setRevision((value) => value + 1) }
}
