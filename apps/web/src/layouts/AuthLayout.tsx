import type { ReactNode } from 'react'
import './AuthLayout.css'

interface AuthLayoutProps {
  children: ReactNode
}

export default function AuthLayout({
  children,
}: AuthLayoutProps) {
  return (
    <div className="auth-shell">
      <aside className="auth-shell__brand">
        <div className="auth-shell__logo">
          <div className="auth-shell__logo-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M2 3h2l2.5 12h12l3-9H5" />
              <circle cx="9" cy="20" r="1" />
              <circle cx="18" cy="20" r="1" />
            </svg>
          </div>
          <div>
            <strong>POSMYCLETH</strong>
            <span>POS · CRM · ECOMMERCE</span>
          </div>
        </div>

        <div className="auth-shell__hero">
          <p className="auth-shell__eyebrow">
            SOLUCIÓN EMPRESARIAL
          </p>

          <h2>
            Tu negocio, en las
            <span> mejores manos.</span>
          </h2>

          <p className="auth-shell__description">
            Gestiona tus ventas, controla tu inventario
            y administra las operaciones de tu negocio
            desde una plataforma integrada.
          </p>

          <div className="auth-shell__features">
            <span>Ventas</span>
            <span>Inventario</span>
            <span>Catálogo</span>
          </div>
        </div>

        <div className="auth-shell__illustration" aria-hidden="true">
          <div className="auth-shell__terminal">
            <div className="auth-shell__screen">
              <div className="auth-shell__screen-header">
                <span>Panel de control</span>
                <span className="auth-shell__screen-dot" />
              </div>
              <div className="auth-shell__bars">
                <i /><i /><i /><i /><i /><i /><i />
              </div>
              <div className="auth-shell__screen-bottom">
                <span /><span /><span />
              </div>
            </div>
            <div className="auth-shell__stand" />
          </div>
        </div>

        <p className="auth-shell__brand-footer">
          Tecnología para la gestión de tu negocio.
        </p>
      </aside>

      <section className="auth-shell__content">
        <div className="auth-shell__lock" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <rect x="5" y="10" width="14" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            <circle cx="12" cy="15" r="1" />
          </svg>
        </div>

        {children}

        <p className="auth-shell__legal">
          Acceso exclusivo para usuarios autorizados.
        </p>
      </section>
    </div>
  )
}
