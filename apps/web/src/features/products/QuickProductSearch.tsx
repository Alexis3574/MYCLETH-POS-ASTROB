import { useEffect, useRef, useState } from 'react'
import { commercialService } from '../commercial/commercial.service'
import type { Product } from '../commercial/commercial.types'
import { getAuthSession, clearAuthSession } from '../auth/auth.session'
import { ApiHttpError } from '../../services/api'

export default function QuickProductSearch({ onSelect }: { onSelect: (product: Product) => boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.key === 'F2' && !event.altKey && !event.ctrlKey && !event.metaKey && !document.querySelector('dialog[open]')) {
        event.preventDefault(); input.current?.focus(); input.current?.select()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => { window.removeEventListener('keydown', shortcut); request.current?.abort() }
  }, [])
  async function scan() {
    const session = getAuthSession(), code = text.trim()
    if (!session || !code || request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setMessage('Buscando código…')
    try {
      const data = await commercialService.products(session.accessToken, code, 'true', 1, controller.signal)
      if (controller.signal.aborted || getAuthSession()?.accessToken !== session.accessToken) return
      const matches = data.items.filter(item => item.activo && item.unidad_medida.activo && (item.codigo_barras === code || item.sku === code))
      if (matches.length !== 1 || data.total > data.size) {
        setMessage(matches.length ? 'El código no identifica un único artículo. Usa el catálogo para seleccionarlo.' : 'Sin coincidencia exacta. Busca por nombre o código en el catálogo.')
      } else if (onSelect(matches[0])) { setText(''); setMessage('Agregado: ' + matches[0].nombre) }
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof ApiHttpError && cause.status === 401 && getAuthSession()?.accessToken === session.accessToken) clearAuthSession()
        setMessage(cause instanceof Error ? cause.message : 'No se pudo consultar el producto.')
      }
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(false); input.current?.focus(); input.current?.select() }
    }
  }
  return <section className="commercial-panel"><h2>Captura rápida</h2>
    <form className="commercial-search" onSubmit={event => { event.preventDefault(); void scan() }}>
      <label>Código de barras o SKU · F2<input ref={input} type="text" autoComplete="off" maxLength={180} value={text} readOnly={busy} onChange={event => setText(event.target.value)} /></label>
      <button type="submit" className="sales-button" disabled={busy || !text.trim()}>Agregar por código</button>
    </form><p className="sales-muted">Escanea y pulsa Enter. El buscador conserva el foco para el siguiente artículo.</p>
    <p role="status" aria-live="polite">{message}</p>
  </section>
}
