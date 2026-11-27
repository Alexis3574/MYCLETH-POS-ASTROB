import { useState } from 'react'
import type { FormEvent } from 'react'

import type { AuthUser } from '../features/auth/auth.types'

import { useAuthSession } from '../features/auth/useAuthSession'

import { useDashboardSummary } from '../features/dashboard/useDashboardSummary'

import type {
  DashboardDailyTrend,
  DashboardFilters,
} from '../features/dashboard/dashboard.types'

import './DashboardPage.css'

interface DashboardPageProps {
  user: AuthUser
}

type QuickPeriod = 'today' | '7days' | '30days' | 'custom'

interface MetricCardProps {
  label: string
  value: string
  description?: string
  variant?: 'default' | 'warning' | 'danger'
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('es-MX').format(value)
}

function formatMoney(
  value: string,
  currency: string | null,
): string {
  const amount = Number(value)

  if (!Number.isFinite(amount)) {
    return value
  }

  if (currency) {
    try {
      return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency,
      }).format(amount)
    } catch {
      // Formato alternativo si la moneda no es reconocida.
    }
  }

  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatDate(date: string): string {
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}

function todayInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? ''

  return `${part('year')}-${part('month')}-${part('day')}`
}

function subtractCalendarDays(
  date: string,
  numberOfDays: number,
): string {
  const timestamp = Date.parse(`${date}T00:00:00.000Z`)

  return new Date(timestamp - numberOfDays * 86400000)
    .toISOString()
    .slice(0, 10)
}

function MetricCard({
  label,
  value,
  description,
  variant = 'default',
}: MetricCardProps) {
  return (
    <article
      className={`dashboard-metric dashboard-metric--${variant}`}
    >
      <span className="dashboard-metric__label">
        {label}
      </span>

      <strong className="dashboard-metric__value">
        {value}
      </strong>

      {description && (
        <small className="dashboard-metric__description">
          {description}
        </small>
      )}
    </article>
  )
}

function positiveAmount(value: string): number {
  const amount = Number(value)

  return Number.isFinite(amount)
    ? Math.max(0, amount)
    : 0
}

function SalesTrend({
  days,
  currency,
}: {
  days: DashboardDailyTrend[]
  currency: string | null
}) {
  const maxValue = Math.max(
    1,
    ...days.flatMap((day) => [
      positiveAmount(day.ventas_brutas),
      positiveAmount(day.devoluciones),
    ]),
  )

  if (days.length === 0) {
    return (
      <p className="dashboard-home__message">
        No hay información de tendencia para este periodo.
      </p>
    )
  }

  const allAmountsZero = days.every((day) =>
    [
      day.ventas_brutas,
      day.devoluciones,
      day.ventas_netas,
    ].every((amount) => Number(amount) === 0),
  )

  return (
    <>
      {allAmountsZero ? (
        <div className="dashboard-trend__empty" role="status">
          <strong>
            No se registraron ventas en este periodo
          </strong>
          <p>
            Puedes seleccionar otro rango de fechas
            para consultar la actividad comercial.
          </p>
        </div>
      ) : (
        <>
          <div className="dashboard-trend__legend">
        <span>
          <i className="dashboard-trend__legend-gross" />
          Ventas brutas
        </span>

        <span>
          <i className="dashboard-trend__legend-return" />
          Devoluciones
        </span>
      </div>

      <div className="dashboard-trend__scroll">
        <div
          className="dashboard-trend__chart"
          aria-hidden="true"
        >
          {days.map((day) => {
            const gross = positiveAmount(day.ventas_brutas)
            const returned = positiveAmount(day.devoluciones)

            return (
              <div
                className="dashboard-trend__day"
                key={day.fecha}
              >
                <div className="dashboard-trend__bars">
                  <div
                    className="dashboard-trend__bar dashboard-trend__bar--gross"
                    style={{
                      height: `${gross / maxValue * 100}%`,
                    }}
                  />

                  <div
                    className="dashboard-trend__bar dashboard-trend__bar--return"
                    style={{
                      height: `${returned / maxValue * 100}%`,
                    }}
                  />
                </div>

                <span>
                  {day.fecha.slice(8, 10)}/
                  {day.fecha.slice(5, 7)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
        </>
      )}

      <details className="dashboard-trend__details">
        <summary>
          Ver detalle diario ({days.length} días)
        </summary>

        <div className="dashboard-trend__table-scroll">
        <table className="dashboard-trend__table">
          <caption>
            Detalle diario de ventas y devoluciones
          </caption>

          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Ventas brutas</th>
              <th scope="col">Devoluciones</th>
              <th scope="col">Ventas netas</th>
            </tr>
          </thead>

          <tbody>
            {days.map((day) => (
              <tr key={day.fecha}>
                <td>{formatDate(day.fecha)}</td>
                <td>
                  {formatMoney(day.ventas_brutas, currency)}
                </td>
                <td>
                  {formatMoney(day.devoluciones, currency)}
                </td>
                <td>
                  {formatMoney(day.ventas_netas, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </details>
    </>
  )
}

export default function DashboardPage({
  user,
}: DashboardPageProps) {
  const session = useAuthSession()

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [activePeriod, setActivePeriod] =
    useState<QuickPeriod>('7days')

  const [appliedFilters, setAppliedFilters] =
    useState<DashboardFilters>({})

  const [validationError, setValidationError] =
    useState<string | null>(null)

  const allowed = user.permisos.some(
    (permission) => permission.codigo === 'DASHBOARD.VER',
  )

  const {
    status,
    data,
    error,
    refresh,
  } = useDashboardSummary({
    token: session?.accessToken ?? null,
    allowed,
    filters: appliedFilters,
  })

  function applyQuickPeriod(
    period: Exclude<QuickPeriod, 'custom'>,
  ) {
    const timezone = data?.periodo.zona_horaria

    if (!timezone) {
      return
    }

    const days =
      period === 'today'
        ? 1
        : period === '7days'
          ? 7
          : 30

    const today = todayInTimeZone(timezone)
    const from = subtractCalendarDays(today, days - 1)

    setDateFrom(from)
    setDateTo(today)
    setValidationError(null)
    setActivePeriod(period)

    setAppliedFilters({
      fecha_desde: from,
      fecha_hasta: today,
    })

    refresh()
  }

  function applyFilters(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()
    setValidationError(null)

    if (dateFrom || dateTo) {
      if (!dateFrom || !dateTo) {
        setValidationError(
          'Selecciona ambas fechas para filtrar.',
        )
        return
      }

      const start = Date.parse(`${dateFrom}T00:00:00Z`)
      const end = Date.parse(`${dateTo}T00:00:00Z`)

      const difference = (end - start) / 86400000

      if (
        !Number.isFinite(difference) ||
        difference < 0 ||
        difference > 30
      ) {
        setValidationError(
          'El periodo debe estar ordenado y no superar 31 días.',
        )
        return
      }
    }

    setAppliedFilters(
      dateFrom && dateTo
        ? {
            fecha_desde: dateFrom,
            fecha_hasta: dateTo,
          }
        : {},
    )

    setActivePeriod('custom')
    refresh()
  }

  function resetFilters() {
    setDateFrom('')
    setDateTo('')
    setValidationError(null)
    setAppliedFilters({})
    setActivePeriod('7days')
    refresh()
  }

  const indicators = data?.indicadores ?? {}
  const currency = data?.periodo.moneda ?? null

  const hasIndicators = Boolean(
    indicators?.ventas ||
    indicators?.caja ||
    indicators?.inventario ||
    indicators?.ecommerce,
  )

  return (
    <div className="dashboard-home">
      <header className="dashboard-home__heading">
        <div>
          <p className="dashboard-home__eyebrow">
            VISTA GENERAL
          </p>

          <h1>
            Bienvenido, {user.nombre || user.username}
          </h1>

          <p>
            Resumen operativo de {user.empresa.nombre}
          </p>
        </div>

        <span className="dashboard-home__status">
          Sesión activa
        </span>
      </header>

      {allowed && (
        <section
          className="dashboard-home__filters"
          aria-label="Filtros del dashboard"
        >
          <div
            className="dashboard-home__quick"
            role="group"
            aria-label="Filtros rápidos de fechas"
          >
            <button
              type="button"
              className={`dashboard-home__quick-button${
                activePeriod === 'today' ? ' is-active' : ''
              }`}
              aria-pressed={activePeriod === 'today'}
              disabled={!data}
              onClick={() => applyQuickPeriod('today')}
            >
              Hoy
            </button>

            <button
              type="button"
              className={`dashboard-home__quick-button${
                activePeriod === '7days' ? ' is-active' : ''
              }`}
              aria-pressed={activePeriod === '7days'}
              disabled={!data}
              onClick={() => applyQuickPeriod('7days')}
            >
              Últimos 7 días
            </button>

            <button
              type="button"
              className={`dashboard-home__quick-button${
                activePeriod === '30days' ? ' is-active' : ''
              }`}
              aria-pressed={activePeriod === '30days'}
              disabled={!data}
              onClick={() => applyQuickPeriod('30days')}
            >
              Últimos 30 días
            </button>
          </div>

          <form onSubmit={applyFilters}>
            <div className="dashboard-home__filter-field">
              <label htmlFor="dashboard-from">
                Fecha desde
              </label>

              <input
                id="dashboard-from"
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setDateFrom(event.target.value)
                  setActivePeriod('custom')
                }}
              />
            </div>

            <div className="dashboard-home__filter-field">
              <label htmlFor="dashboard-to">
                Fecha hasta
              </label>

              <input
                id="dashboard-to"
                type="date"
                value={dateTo}
                onChange={(event) => {
                  setDateTo(event.target.value)
                  setActivePeriod('custom')
                }}
              />
            </div>

            <button
              type="submit"
              className="dashboard-home__button"
            >
              Aplicar
            </button>

            <button
              type="button"
              className="dashboard-home__button dashboard-home__button--secondary"
              onClick={resetFilters}
            >
              Restablecer
            </button>

            <button
              type="button"
              className="dashboard-home__button dashboard-home__button--secondary"
              onClick={refresh}
              disabled={status === 'loading'}
            >
              Actualizar
            </button>
          </form>

          {validationError && (
            <p
              className="dashboard-home__validation"
              role="alert"
            >
              {validationError}
            </p>
          )}

          {activePeriod === '7days' &&
            !dateFrom &&
            !dateTo && (
            <p className="dashboard-home__filter-note">
              Sin fechas seleccionadas: la API consulta
              los últimos 7 días según la zona horaria
              de la empresa.
            </p>
          )}
        </section>
      )}

      {status === 'loading' && (
        <section
          className="dashboard-home__feedback"
          role="status"
        >
          <h2>Cargando indicadores</h2>
          <p>
            Consultando información operativa del sistema.
          </p>
        </section>
      )}

      {status === 'forbidden' && (
        <section
          className="dashboard-home__feedback"
          role="alert"
        >
          <h2>Acceso restringido</h2>
          <p>
            {error ||
              'Tu usuario no tiene autorización para consultar este dashboard.'}
          </p>
        </section>
      )}

      {status === 'error' && (
        <section
          className="dashboard-home__feedback"
          role="alert"
        >
          <h2>No se pudieron cargar los indicadores</h2>
          <p>
            {error || 'Ocurrió un error al consultar la API.'}
          </p>

          <button
            type="button"
            className="dashboard-home__button"
            onClick={refresh}
          >
            Reintentar
          </button>
        </section>
      )}

      {status === 'success' && data && (
        <>
          <section className="dashboard-home__period">
            <div>
              <span>Periodo consultado</span>

              <strong>
                {formatDate(data.periodo.fecha_desde)}
                {' — '}
                {formatDate(data.periodo.fecha_hasta)}
              </strong>
            </div>

            <small>
              Zona horaria: {data.periodo.zona_horaria}
            </small>
          </section>

          {!hasIndicators && (
            <section className="dashboard-home__feedback">
              <h2>Sin indicadores autorizados</h2>
              <p>
                Tu usuario puede acceder al dashboard,
                pero no tiene permisos para consultar
                los indicadores operativos.
              </p>
            </section>
          )}

          {indicators.ventas && (
            <section className="dashboard-home__section">
              <h2>Resumen de ventas</h2>

              <div className="dashboard-home__cards">
                <MetricCard
                  label="Ventas netas"
                  value={formatMoney(
                    indicators.ventas.ventas_netas,
                    currency,
                  )}
                  description="Ventas menos devoluciones"
                />

                <MetricCard
                  label="Ventas brutas"
                  value={formatMoney(
                    indicators.ventas.ventas_brutas,
                    currency,
                  )}
                />

                <MetricCard
                  label="Operaciones"
                  value={formatNumber(
                    indicators.ventas.operaciones,
                  )}
                />

                <MetricCard
                  label="Ticket promedio"
                  value={formatMoney(
                    indicators.ventas.ticket_promedio,
                    currency,
                  )}
                />

                <MetricCard
                  label="Monto devuelto"
                  value={formatMoney(
                    indicators.ventas.monto_devuelto,
                    currency,
                  )}
                  variant="warning"
                />

                <MetricCard
                  label="Devoluciones registradas"
                  value={formatNumber(
                    indicators.ventas.devoluciones_registradas,
                  )}
                />
              </div>

              <div className="dashboard-home__panel">
                <div className="dashboard-home__panel-title">
                  <div>
                    <h2>Tendencia diaria de ventas</h2>
                    <p>
                      Comparación de ventas brutas y devoluciones
                    </p>
                  </div>
                </div>

                <div className="dashboard-home__panel-body">
                  <SalesTrend
                    days={indicators.ventas.tendencia_diaria}
                    currency={currency}
                  />
                </div>
              </div>
            </section>
          )}

          {indicators.caja && (
            <section className="dashboard-home__section">
              <h2>Estado de cajas</h2>

              <div className="dashboard-home__cards">
                <MetricCard
                  label="Cajas activas"
                  value={formatNumber(
                    indicators.caja.cajas_activas,
                  )}
                />

                <MetricCard
                  label="Sesiones abiertas"
                  value={formatNumber(
                    indicators.caja.sesiones_abiertas,
                  )}
                />
              </div>
            </section>
          )}

          {indicators.inventario && (
            <section className="dashboard-home__section">
              <h2>Estado del inventario</h2>

              <div className="dashboard-home__cards">
                <MetricCard
                  label="Existencias registradas"
                  value={formatNumber(
                    indicators.inventario.existencias_registradas,
                  )}
                />

                <MetricCard
                  label="Bajo mínimo"
                  value={formatNumber(
                    indicators.inventario.bajo_minimo,
                  )}
                  variant="warning"
                />

                <MetricCard
                  label="Agotadas"
                  value={formatNumber(
                    indicators.inventario.agotadas,
                  )}
                  variant="danger"
                />
              </div>
            </section>
          )}

          {indicators.ecommerce && (
            <section className="dashboard-home__section">
              <h2>Integración E-commerce</h2>

              <div className="dashboard-home__cards">
                <MetricCard
                  label="Sincronizaciones pendientes o con error"
                  value={formatNumber(
                    indicators.ecommerce.pendientes_o_error,
                  )}
                  variant="warning"
                />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
