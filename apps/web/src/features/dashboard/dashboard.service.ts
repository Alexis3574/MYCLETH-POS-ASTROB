import { apiRequest } from '../../services/api'

import type {
  DashboardFilters,
  DashboardSummary,
  DashboardSummaryResponse,
} from './dashboard.types'

function buildDashboardPath(
  filters: DashboardFilters,
): `/${string}` {
  const params = new URLSearchParams()

  if (filters.fecha_desde) {
    params.set('fecha_desde', filters.fecha_desde)
  }

  if (filters.fecha_hasta) {
    params.set('fecha_hasta', filters.fecha_hasta)
  }

  if (filters.sucursal_id) {
    params.set('sucursal_id', filters.sucursal_id)
  }

  const query = params.toString()

  return query
    ? `/dashboard/summary?${query}`
    : '/dashboard/summary'
}

export const dashboardService = {
  async getSummary(
    token: string,
    filters: DashboardFilters = {},
    signal?: AbortSignal,
  ): Promise<DashboardSummary> {
    const response =
      await apiRequest<DashboardSummaryResponse>(
        buildDashboardPath(filters),
        {
          method: 'GET',
          token,
          signal,
        },
      )

    return response.data
  },
}
