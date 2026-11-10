import { useCallback, useEffect, useState } from 'react'
import { ApiHttpError } from '../../services/api'
import { clearAuthSession, getAuthSession } from '../auth/auth.session'
import { useAuthSession } from '../auth/useAuthSession'
import { readSalesQuery } from './sales.query'
import { salesService } from './sales.service'

type Status = 'idle' | 'loading' | 'success' | 'forbidden' | 'not-found' | 'error'
interface Result<T> { key: string; status: Status; data: T | null; error: string | null }

function useSalesResource<T>(
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
export function useSalesList(search: string, enabled: boolean) {
  const load = useCallback((token: string, signal: AbortSignal) => {
    const { query, error } = readSalesQuery(new URLSearchParams(search))
    if (error) return Promise.reject(new Error(error))
    return salesService.list(token, query, signal)
  }, [search])
  return useSalesResource('list:' + search, enabled, load)
}
export function useSaleDetail(id: string, enabled: boolean) {
  const load = useCallback((token: string, signal: AbortSignal) => salesService.detail(token, id, signal), [id])
  return useSalesResource('detail:' + id, enabled, load)
}
export function useSaleFinancial(id: string, enabled: boolean) {
  const load = useCallback((token: string, signal: AbortSignal) => salesService.financial(token, id, signal), [id])
  return useSalesResource('financial:' + id, enabled, load)
}
