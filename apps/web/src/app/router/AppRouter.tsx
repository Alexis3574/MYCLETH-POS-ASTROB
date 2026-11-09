import {
  useEffect,
  useState,
} from 'react'

import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router'

import AuthLayout from '../../layouts/AuthLayout'
import DashboardLayout from '../../layouts/DashboardLayout'

import LoginPage from '../../pages/LoginPage'
import DashboardPage from '../../pages/DashboardPage'

import { authService } from '../../features/auth/auth.service'

import { useAuthSession } from '../../features/auth/useAuthSession'

import {
  clearAuthSession,
  getAuthSession,
  updateAuthSessionUser,
} from '../../features/auth/auth.session'

import { ApiHttpError } from '../../services/api'

function AppRoutes() {
  const session = useAuthSession()

  const [validatingSession, setValidatingSession] =
    useState(() => getAuthSession() !== null)

  useEffect(() => {
    if (!validatingSession) {
      return
    }

    const storedSession = getAuthSession()

    if (!storedSession) {
      Promise.resolve().then(() => setValidatingSession(false))
      return
    }

    let cancelled = false

    authService
      .getMe(storedSession.accessToken)
      .then((response) => {
        if (cancelled) {
          return
        }

        const currentSession = getAuthSession()

        if (
          currentSession?.accessToken !==
          storedSession.accessToken
        ) {
          return
        }

        updateAuthSessionUser(response)
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        const currentSession = getAuthSession()

        if (
          currentSession?.accessToken !==
          storedSession.accessToken
        ) {
          return
        }

        if (
          error instanceof ApiHttpError &&
          (error.status === 401 || error.status === 403)
        ) {
          clearAuthSession()
        }
      })
      .finally(() => {
        if (!cancelled) {
          setValidatingSession(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [validatingSession])

  if (validatingSession) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          padding: '32px',
          color: '#152b47',
          textAlign: 'center',
        }}
      >
        Verificando sesión...
      </div>
    )
  }

  const defaultPath = session
    ? '/dashboard'
    : '/login'

  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to={defaultPath} replace />}
      />

      <Route
        path="/login"
        element={
          session ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <AuthLayout>
              <LoginPage />
            </AuthLayout>
          )
        }
      />

      <Route
        path="/dashboard"
        element={
          session ? (
            <DashboardLayout
              user={session.user}
              onLogout={clearAuthSession}
            >
              <DashboardPage user={session.user} />
            </DashboardLayout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="*"
        element={<Navigate to={defaultPath} replace />}
      />
    </Routes>
  )
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
