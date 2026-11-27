import { useCallback } from 'react'
import { useRemoteResource } from '../../hooks/useRemoteResource'
import { readSalesQuery } from './sales.query'
import { salesService } from './sales.service'
export function useSalesList(search: string, enabled: boolean) {
  const load = useCallback((token: string, signal: AbortSignal) => {
    const { query, error } = readSalesQuery(new URLSearchParams(search))
    if (error) return Promise.reject(new Error(error))
    return salesService.list(token, query, signal)
  }, [search])
  return useRemoteResource('list:' + search, enabled, load)
}
export function useSaleDetail(id: string, enabled: boolean) {
  const load = useCallback((token: string, signal: AbortSignal) => salesService.detail(token, id, signal), [id])
  return useRemoteResource('detail:' + id, enabled, load)
}
export function useSaleFinancial(id: string, enabled: boolean) {
  const load = useCallback((token: string, signal: AbortSignal) => salesService.financial(token, id, signal), [id])
  return useRemoteResource('financial:' + id, enabled, load)
}
