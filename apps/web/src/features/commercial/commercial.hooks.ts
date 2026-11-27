import { useCallback } from 'react'
import { useRemoteResource } from '../../hooks/useRemoteResource'
import { useAuthSession } from '../auth/useAuthSession'
import { commercialService as api } from './commercial.service'

export function usePermission(code: string) {
  return useAuthSession()?.user.permisos.some((permission) => permission.codigo === code) ?? false
}
export function useProducts(search: string, active: string, page: number, enabled: boolean) {
  const load = useCallback((token: string, signal: AbortSignal) => api.products(token, search, active, page, signal), [search, active, page])
  return useRemoteResource(`products:${search}:${active}:${page}`, enabled, load)
}
export function useCustomers(search: string, active: string, page: number, enabled: boolean) {
  const load = useCallback((token: string, signal: AbortSignal) => api.customers(token, search, active, page, signal), [search, active, page])
  return useRemoteResource(`customers:${search}:${active}:${page}`, enabled, load)
}
export function useWarehouses(page: number, enabled: boolean) {
  const load = useCallback((token: string, signal: AbortSignal) => api.warehouses(token, page, signal), [page])
  return useRemoteResource(`warehouses:${page}`, enabled, load)
}
export function useStock(warehouse: string, search: string, page: number, enabled: boolean, productId?: string) {
  const load = useCallback((token: string, signal: AbortSignal) => api.stock(token, warehouse, search, page, signal, productId), [warehouse, search, page, productId])
  return useRemoteResource(`stock:${warehouse}:${search}:${page}:${productId}`, enabled && !!warehouse, load)
}
export function useMethods(page: number, enabled: boolean) {
  const load = useCallback((token: string, signal: AbortSignal) => api.methods(token, page, signal), [page])
  return useRemoteResource(`methods:${page}`, enabled, load)
}
export function useCash(branch: string, page: number, enabled: boolean) {
  const load = useCallback((token: string, signal: AbortSignal) => api.cash(token, branch, page, signal), [branch, page])
  return useRemoteResource(`cash:${branch}:${page}`, enabled, load)
}
export function useCurrentSession(cashId: string, enabled: boolean) {
  const load = useCallback((token: string, signal: AbortSignal) => api.currentSession(token, cashId, signal), [cashId])
  return useRemoteResource(`cash-session:${cashId}`, enabled && !!cashId, load)
}
