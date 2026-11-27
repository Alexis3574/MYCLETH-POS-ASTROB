import { apiRequest } from '../../services/api'
import { parsePage, parseSupplier, parseSupplierDetail, responseData, validId } from './supplier.parse'
export const supplierService = {
  async list(token: string, q: string, active: string, page: number, signal: AbortSignal) {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' })
    if (q) params.set('q', q)
    if (active) params.set('activo', active)
    return parsePage(await apiRequest(`/suppliers?${params}`, { token, signal }), parseSupplier, page)
  },
  async detail(token: string, id: string, signal: AbortSignal) {
    if (!validId(id)) throw new Error('Proveedor no válido.')
    return parseSupplierDetail(responseData(await apiRequest(`/suppliers/${id}`, { token, signal })), id)
  },
}
