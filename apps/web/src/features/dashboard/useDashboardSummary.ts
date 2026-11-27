import {
  useEffect,
  useState,
} from 'react'

import { ApiHttpError } from '../../services/api'

import {
  clearAuthSession,
  getAuthSession,
} from '../auth/auth.session'

import { dashboardService } from './dashboard.service'

import type {
  DashboardFilters,
  DashboardSummary,
} from './dashboard.types'

export type DashboardStatus =
  | 'idle'
  | 'loading'
  | 'success'
  | 'forbidden'
  | 'error'

interface DashboardResult {
  requestKey: string
  status: 'success' | 'forbidden' | 'error'
  data: DashboardSummary | null
  error: string | null
}

interface UseDashboardSummaryOptions {
  token: string | null
  allowed: boolean
  filters?: DashboardFilters
}

export function useDashboardSummary({
  token,
  allowed,
  filters = {},
}: UseDashboardSummaryOptions) {
  const [revision, setRevision] = useState(0)

  const [result, setResult] =
    useState<DashboardResult | null>(null)

  const {
    fecha_desde,
    fecha_hasta,
    sucursal_id,
  } = filters

  const requestKey = [
    token ?? '',
    fecha_desde ?? '',
    fecha_hasta ?? '',
    sucursal_id ?? '',
    String(revision),
  ].join('|')

  useEffect(() => {
    if (!token || !allowed) {
      return
    }

    const controller = new AbortController()

    dashboardService
      .getSummary(
        token,
        {
          fecha_desde,
          fecha_hasta,
          sucursal_id,
        },
        controller.signal,
      )
      .then((data) => {
        if (controller.signal.aborted) {
          return
        }

        setResult({
          requestKey,
          status: 'success',
          data,
          error: null,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }

        if (
          error instanceof ApiHttpError &&
          error.status === 401
        ) {
          if (
            getAuthSession()?.accessToken === token
          ) {
            clearAuthSession()
          }

          return
        }

        if (
          error instanceof ApiHttpError &&
          error.status === 403
        ) {
          setResult({
            requestKey,
            status: 'forbidden',
            data: null,
            error: 'No tienes autorización para consultar este dashboard.',
          })

          return
        }

        setResult({
          requestKey,
          status: 'error',
          data: null,
          error:
            error instanceof Error
              ? error.message
              : 'No se pudo consultar el dashboard.',
        })
      })

    return () => {
      controller.abort()
    }
  }, [
    token,
    allowed,
    fecha_desde,
    fecha_hasta,
    sucursal_id,
    revision,
    requestKey,
  ])

  let status: DashboardStatus = 'loading'
  let data: DashboardSummary | null = null
  let error: string | null = null

  if (!allowed) {
    status = 'forbidden'
  } else if (!token) {
    status = 'idle'
  } else if (
    result &&
    result.requestKey === requestKey
  ) {
    status = result.status
    data = result.data
    error = result.error
  }

  function refresh() {
    setRevision((current) => current + 1)
  }

  return {
    status,
    data,
    error,
    refresh,
  }
}
