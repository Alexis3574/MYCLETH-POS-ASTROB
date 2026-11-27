export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'

export interface ApiRequestOptions {
  method?: HttpMethod
  body?: unknown
  token?: string
  signal?: AbortSignal
  idempotencyKey?: string
}

export class ApiHttpError extends Error {
  readonly status: number
  readonly payload: unknown
  constructor(
    status: number,
    message: string,
    payload: unknown,
  ) {
    super(message)
    this.name = 'ApiHttpError'
    this.status = status
    this.payload = payload
  }
}

function getErrorMessage(
  payload: unknown,
  fallback: string,
): string {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    'message' in payload &&
    typeof payload.message === 'string'
  ) {
    return payload.message
  }

  return fallback
}

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || '/api/v1'
).replace(/\/+$/, '')

export async function apiRequest<T>(
  path: `/${string}`,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, token, signal, idempotencyKey } = options
  if (idempotencyKey !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) throw new Error('Clave de operación no válida.')

  const response = await fetch(
    `${API_BASE_URL}${path}`,
    {
      method,
      signal,
      headers: {
        Accept: 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        ...(body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(token
          ? { Authorization: `Bearer ${token}` }
          : {}),
      },
      ...(body !== undefined
        ? { body: JSON.stringify(body) }
        : {}),
    },
  )

  const payload: unknown =
    await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiHttpError(
      response.status,
      getErrorMessage(payload, response.statusText),
      payload,
    )
  }

  return payload as T
}
