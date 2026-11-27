import {
  useEffect,
  useRef,
  useState,
} from 'react'

import type { ReactNode } from 'react'
import { NavLink } from 'react-router'

import type { AuthUser } from '../features/auth/auth.types'

import {
  getVisibleNavigationSections,
} from '../app/navigation/navigation.config'

import './DashboardLayout.css'

interface DashboardLayoutProps {
  user: AuthUser
  onLogout: () => void
  children: ReactNode
}

const SIDEBAR_KEY = 'posmycleth.sidebar.collapsed'

function readSidebarPreference(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === 'true'
  } catch {
    return false
  }
}

export default function DashboardLayout({
  user,
  onLogout,
  children,
}: DashboardLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  const [collapsed, setCollapsed] = useState(
    readSidebarPreference,
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIDEBAR_KEY,
        String(collapsed),
      )
    } catch {
      // La preferencia funciona durante la sesión actual.
    }
  }, [collapsed])

  useEffect(() => {
    const sidebar = sidebarRef.current
    const menuButton = menuButtonRef.current

    if (!menuOpen || !sidebar) {
      return
    }

    const mobileViewport = window.matchMedia('(max-width: 850px)')

    function getFocusableElements() {
      return Array.from(
        sidebar!.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex="0"]',
        ),
      ).filter((element) => element.getClientRects().length > 0)
    }

    const firstElement = getFocusableElements()[0] ?? sidebar
    firstElement.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenuOpen(false)
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const elements = getFocusableElements()
      const first = elements[0]
      const last = elements[elements.length - 1]

      if (!first || !last) {
        event.preventDefault()
        sidebar!.focus()
        return
      }

      const activeElement = document.activeElement
      const outsideMenu = !sidebar!.contains(activeElement)

      if (event.shiftKey && (activeElement === first || outsideMenu)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (activeElement === last || outsideMenu)) {
        event.preventDefault()
        first.focus()
      }
    }

    function handleViewportChange() {
      if (!mobileViewport.matches) {
        if (sidebar!.contains(document.activeElement)) {
          sidebar!.querySelector<HTMLElement>('a[href]')?.focus()
        }
        setMenuOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    mobileViewport.addEventListener('change', handleViewportChange)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      mobileViewport.removeEventListener('change', handleViewportChange)

      if (mobileViewport.matches && menuButton?.isConnected) {
        menuButton.focus()
      }
    }
  }, [menuOpen])

  const fullName = [
    user.nombre,
    user.apellido,
  ].filter(Boolean).join(' ')

  const visibleSections = getVisibleNavigationSections(
    user.permisos.map((permission) => permission.codigo),
  )

  function closeMenu() {
    setMenuOpen(false)
  }

  function toggleSidebar() {
    setCollapsed((current) => !current)
  }

  return (
    <div
      className={
        `dashboard-shell${collapsed ? ' is-collapsed' : ''}`
      }
    >
      {menuOpen && (
        <button
          type="button"
          className="dashboard-backdrop"
          aria-label="Cerrar menú"
          onClick={closeMenu}
        />
      )}

      <aside
        ref={sidebarRef}
        tabIndex={-1}
        id="pos-sidebar"
        className={
          `dashboard-sidebar${menuOpen ? ' is-open' : ''}`
        }
        aria-label="Navegación principal"
      >
        <div className="dashboard-brand">
          <span className="dashboard-brand-icon">
            P
          </span>

          <div className="dashboard-brand-copy">
            <strong>POSMYCLETH</strong>
            <small>Panel administrativo</small>
          </div>
        </div>

        <button
          type="button"
          className="dashboard-menu-close"
          onClick={closeMenu}
        >
          Cerrar menú
        </button>

        <nav
          className="dashboard-nav"
          aria-label="Módulos"
        >
          {visibleSections.map((section) => (
            <div
              key={section.id}
              className="dashboard-nav-section"
            >
              <span className="dashboard-nav-label">
                {section.label}
              </span>

              {section.items.map((item) => {
                if (item.to) {
                  return (
                    <NavLink
                      key={item.id}
                      to={item.to}
                      end
                      aria-label={item.label}
                      title={
                        collapsed
                          ? item.label
                          : undefined
                      }
                      className={({ isActive }) =>
                        isActive
                          ? 'dashboard-nav-active'
                          : 'dashboard-nav-link'
                      }
                      onClick={closeMenu}
                    >
                      <span
                        className="dashboard-nav-icon"
                        aria-hidden="true"
                      >
                        {item.icon}
                      </span>

                      <span className="dashboard-nav-item-label">
                        {item.label}
                      </span>
                    </NavLink>
                  )
                }

                return (
                  <span
                    key={item.id}
                    className="dashboard-nav-pending"
                    aria-disabled="true"
                    aria-label={item.label}
                    title={item.label}
                  >
                    <span
                      className="dashboard-nav-icon"
                      aria-hidden="true"
                    >
                      {item.icon}
                    </span>

                    <span className="dashboard-nav-item-label">
                      {item.label}
                    </span>
                  </span>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="dashboard-sidebar-footer">
          <small>EMPRESA</small>
          <strong>{user.empresa.nombre}</strong>
        </div>
      </aside>

      <div className="dashboard-main" inert={menuOpen}>
        <header className="dashboard-header">
          <div className="dashboard-header-left">
            <button
              type="button"
              ref={menuButtonRef}
              className="dashboard-menu-button"
              aria-label="Abrir menú"
              aria-controls="pos-sidebar"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              ☰
            </button>

            <button
              type="button"
              className="dashboard-collapse-button"
              aria-label={
                collapsed
                  ? 'Expandir menú lateral'
                  : 'Contraer menú lateral'
              }
              aria-controls="pos-sidebar"
              aria-expanded={!collapsed}
              title={
                collapsed
                  ? 'Expandir menú'
                  : 'Contraer menú'
              }
              onClick={toggleSidebar}
            >
              <svg
                viewBox="0 0 24 24"
                width="19"
                height="19"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect
                  x="3"
                  y="4"
                  width="18"
                  height="16"
                  rx="2"
                />
                <path d="M9 4v16" />
                <path
                  d={
                    collapsed
                      ? 'm14 9 3 3-3 3'
                      : 'm17 9-3 3 3 3'
                  }
                />
              </svg>
            </button>

            <div>
              <span className="dashboard-header-label">
                PANEL ADMINISTRATIVO
              </span>

              <strong>
                {user.empresa.nombre}
              </strong>
            </div>
          </div>

          <div className="dashboard-account">
            <div className="dashboard-account-info">
              <strong>
                {fullName || user.username}
              </strong>

              <small>
                @{user.username}
              </small>
            </div>

            <button
              type="button"
              className="dashboard-logout"
              onClick={onLogout}
            >
              Cerrar sesión
            </button>
          </div>
        </header>

        <main className="dashboard-content">
          {children}
        </main>
      </div>
    </div>
  )
}
