import type {
  AuthUser,
  LoginData,
} from './auth.types'

export interface AuthSession {
  accessToken: string
  user: AuthUser
  expiresAt: number
}

const STORAGE_KEY = 'posmycleth.auth.session.v1'
const MAX_TIMEOUT = 2_147_483_647

const listeners = new Set<() => void>()

function removeStoredSession() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // El almacenamiento puede estar deshabilitado.
  }
}

function readStoredSession(): AuthSession | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)

    if (!raw) {
      return null
    }

    const parsed: unknown = JSON.parse(raw)

    if (!parsed || typeof parsed !== 'object') {
      removeStoredSession()
      return null
    }

    const candidate = parsed as Partial<AuthSession>

    const valid =
      typeof candidate.accessToken === 'string' &&
      candidate.accessToken.length > 0 &&
      typeof candidate.expiresAt === 'number' &&
      Number.isFinite(candidate.expiresAt) &&
      candidate.expiresAt > Date.now() &&
      candidate.user !== null &&
      typeof candidate.user === 'object' &&
      Array.isArray(candidate.user?.permisos) &&
      Array.isArray(candidate.user?.roles)

    if (!valid) {
      removeStoredSession()
      return null
    }

    return candidate as AuthSession
  } catch {
    removeStoredSession()
    return null
  }
}

let session: AuthSession | null = readStoredSession()

let expirationTimer: ReturnType<typeof setTimeout> | null =
  null

function notifyListeners() {
  for (const listener of listeners) {
    listener()
  }
}

function persistSession() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (session) {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(session),
      )
    } else {
      removeStoredSession()
    }
  } catch {
    // La sesión continúa funcionando en memoria.
  }
}

function scheduleExpiration() {
  if (expirationTimer !== null) {
    clearTimeout(expirationTimer)
    expirationTimer = null
  }

  if (!session) {
    return
  }

  const remaining = session.expiresAt - Date.now()

  if (remaining <= 0) {
    clearAuthSession()
    return
  }

  expirationTimer = setTimeout(() => {
    if (session && session.expiresAt <= Date.now()) {
      clearAuthSession()
    } else {
      scheduleExpiration()
    }
  }, Math.min(remaining, MAX_TIMEOUT))
}

export function getAuthSession(): AuthSession | null {
  if (session && session.expiresAt <= Date.now()) {
    return null
  }

  return session
}

export function subscribeAuthSession(
  listener: () => void,
): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function setAuthSession(data: LoginData): void {
  const expiresIn = Number(data.expires_in)

  if (
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    !data.access_token
  ) {
    clearAuthSession()
    return
  }

  session = {
    accessToken: data.access_token,
    user: data.usuario,
    expiresAt: Date.now() + expiresIn * 1000,
  }

  persistSession()
  scheduleExpiration()
  notifyListeners()
}

export function updateAuthSessionUser(user: AuthUser): void {
  const current = getAuthSession()

  if (!current) {
    return
  }

  session = {
    ...current,
    user,
  }

  persistSession()
  notifyListeners()
}

export function clearAuthSession(): void {
  if (expirationTimer !== null) {
    clearTimeout(expirationTimer)
    expirationTimer = null
  }

  session = null

  if (typeof window !== 'undefined') {
    removeStoredSession()
  }

  notifyListeners()
}

scheduleExpiration()
