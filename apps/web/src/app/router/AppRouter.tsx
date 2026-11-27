import {
  useEffect,
  useState,
  lazy,
  Suspense,
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
import SalesPage from '../../pages/SalesPage'
import PosPage from '../../pages/PosPage'
import PurchasesPage from '../../pages/PurchasesPage'
import SuppliersPage from '../../pages/SuppliersPage'
const QuotationsPage = lazy(() => import('../../pages/QuotationsPage'))
const OrdersPage = lazy(() => import('../../pages/OrdersPage'))
const CustomerOrdersPage = lazy(() => import('../../pages/CustomerOrdersPage'))
const CreditsPage = lazy(() => import('../../pages/CreditsPage'))
const UsersPage = lazy(() => import('../../pages/UsersPage'))
const RolesPage = lazy(() => import('../../pages/RolesPage'))
const PermissionsPage = lazy(() => import('../../pages/PermissionsPage'))
import { ProductsPage, CustomersPage, InventoryPage, CashPage } from '../../pages/CommercialPages'
import SaleDetail from '../../features/sales/SaleDetail'

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
        path="/sales"
        element={
          session ? (
            <DashboardLayout user={session.user} onLogout={clearAuthSession}>
              <SalesPage />
            </DashboardLayout>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        <Route path=":saleId" element={<SaleDetail />} />
      </Route>

      {[
        { path: '/pos', page: <PosPage /> },
        { path: '/products', page: <ProductsPage /> },
        { path: '/customers', page: <CustomersPage /> },
        { path: '/inventory', page: <InventoryPage /> },
        { path: '/cash', page: <CashPage /> },
        { path: '/purchases/:purchaseId?', page: <PurchasesPage /> },
        { path: '/suppliers', page: <SuppliersPage /> },
        { path: '/quotes/:documentId?', page: <QuotationsPage /> },
        { path: '/sales-orders/:documentId?', page: <OrdersPage /> },
        { path: '/customer-orders/:documentId?', page: <CustomerOrdersPage /> },
        { path: '/credits', page: <CreditsPage /> },
        { path: '/users/:userId?', page: <UsersPage /> },
        { path: '/roles', page: <RolesPage /> },
        { path: '/permissions', page: <PermissionsPage /> },
      ].map(({ path, page }) => <Route key={path} path={path} element={session
        ? <DashboardLayout user={session.user} onLogout={clearAuthSession}><Suspense fallback={<p role="status">Cargando módulo…</p>}>{page}</Suspense></DashboardLayout>
        : <Navigate to="/login" replace />} />)}
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
