import { apiRequest } from '../../services/api'
import { isSaleId, salesSearch } from './sales.query'
import type { SalesQuery, SalesResponse, SaleDetailData, SaleFinancialData } from './sales.types'

function salePath(id: string): `/${string}` {
  if (!isSaleId(id)) throw new Error('El identificador de la venta no es válido.')
  return `/sales/${id}`
}
export const salesService = {
  async list(token: string, query: SalesQuery, signal: AbortSignal): Promise<SalesResponse> {
    const result = await apiRequest<SalesResponse>(`/sales${salesSearch(query)}`, { token, signal })
    if (!result?.ok || !Array.isArray(result.data) || !result.pagination ||
      !Number.isSafeInteger(result.pagination.total) || !Number.isSafeInteger(result.pagination.totalPages)) {
      throw new Error('El servidor devolvió un listado de ventas no válido.')
    }
    return result
  },
  async detail(token: string, id: string, signal: AbortSignal): Promise<SaleDetailData> {
    const result = await apiRequest<{ ok: true; data: SaleDetailData }>(salePath(id), { token, signal })
    if (!result?.ok || result.data?.id !== id || !Array.isArray(result.data.detalles) || !Array.isArray(result.data.pagos)) {
      throw new Error('El servidor devolvió un detalle de venta no válido.')
    }
    return result.data
  },
  async financial(token: string, id: string, signal: AbortSignal): Promise<SaleFinancialData> {
    const result = await apiRequest<{ ok: true; data: SaleFinancialData }>(
      `${salePath(id)}/financial-summary`, { token, signal },
    )
    if (!result?.ok || result.data?.venta?.id !== id || !result.data.resumen) {
      throw new Error('No se pudo interpretar el resumen financiero.')
    }
    return result.data
  },
}
