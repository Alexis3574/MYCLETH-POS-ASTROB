import type { AuthUser } from '../features/auth/auth.types'
import './DashboardPage.css'

interface DashboardPageProps {
  user: AuthUser
}

export default function DashboardPage({
  user,
}: DashboardPageProps) {
  const name = user.nombre || user.username

  return (
    <div className="dashboard-home">
      <header className="dashboard-home__heading">
        <div>
          <p className="dashboard-home__eyebrow">
            VISTA GENERAL
          </p>
          <h1>Bienvenido, {name}</h1>
          <p>
            Panel administrativo de {user.empresa.nombre}
          </p>
        </div>
        <span className="dashboard-home__status">
          Sesión activa
        </span>
      </header>

      <section
        className="dashboard-home__cards"
        aria-label="Información de la cuenta"
      >
        <article className="dashboard-home__card">
          <span>Empresa</span>
          <strong>{user.empresa.nombre}</strong>
          <small>ID: {user.empresa.id}</small>
        </article>

        <article className="dashboard-home__card">
          <span>Roles asignados</span>
          <strong>{user.roles.length}</strong>
          <small>Según la sesión actual</small>
        </article>

        <article className="dashboard-home__card">
          <span>Permisos registrados</span>
          <strong>{user.permisos.length}</strong>
          <small>Según la sesión actual</small>
        </article>
      </section>

      <section className="dashboard-home__panel">
        <div className="dashboard-home__panel-title">
          <div>
            <h2>Resumen operativo</h2>
            <p>
              Indicadores generales de tu negocio
            </p>
          </div>
          <span>Próximamente</span>
        </div>

        <div className="dashboard-home__empty">
          <div className="dashboard-home__empty-icon">
            ▥
          </div>
          <h3>Preparando tu centro de operaciones</h3>
          <p>
            Los indicadores de ventas, inventario
            y actividad aparecerán cuando conectemos
            sus endpoints y permisos correspondientes.
          </p>
        </div>
      </section>
    </div>
  )
}
