import './LoginPage.css'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { authService } from '../features/auth/auth.service'
import { setAuthSession } from '../features/auth/auth.session'
import { ApiHttpError } from '../services/api'

export default function LoginPage() {
  const [empresaId, setEmpresaId] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current) return

    const empresa = empresaId.trim()
    const user = username.trim()

    if (!/^\d+$/.test(empresa)) {
      setError('Introduce un ID de empresa numerico.')
      return
    }

    if (!user || user.length > 80) {
      setError('El usuario debe tener entre 1 y 80 caracteres.')
      return
    }

    if (!password || new TextEncoder().encode(password).length > 72) {
      setError('La contraseña debe contener entre 1 y 72 bytes.')
      return
    }

    pending.current = true
    setBusy(true)
    setError('')

    try {
      const data = await authService.login({
        empresa_id: empresa,
        username: user,
        password,
      })

      setAuthSession(data)
    } catch (cause) {
      setError(
        cause instanceof ApiHttpError
          ? cause.message
          : 'No fue posible conectar con el servidor.',
      )
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <h1>POSMYCLETH</h1>
      <h2>Iniciar sesión</h2>

      <form onSubmit={handleSubmit}>
        <label htmlFor="empresa">Empresa</label>
        <input
          id="empresa"
          inputMode="numeric"
          autoComplete="organization"
          value={empresaId}
          onChange={(e) => setEmpresaId(e.target.value)}
          required
        />

        <label htmlFor="username">Usuario</label>
        <input
          id="username"
          autoComplete="username"
          maxLength={80}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />

        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <p role="alert">{error}</p>}

        <button type="submit" disabled={busy}>
          {busy ? 'Verificando...' : 'Iniciar sesión'}
        </button>
      </form>
    </main>
  )
}
