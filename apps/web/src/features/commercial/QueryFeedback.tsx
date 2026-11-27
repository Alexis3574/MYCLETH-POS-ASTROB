export default function QueryFeedback({ resource }: { resource: { status: string; error: string | null; refresh: () => void } }) {
  if (resource.status === 'loading') return <p role="status" className="commercial-notice">Consultando…</p>
  if (['error', 'not-found', 'forbidden'].includes(resource.status)) return <div className="commercial-notice commercial-error" role="alert">
    <p>{resource.status === 'forbidden' ? 'No tienes acceso a esta consulta.' : resource.error}</p>
    <button type="button" className="sales-button sales-button--secondary" onClick={resource.refresh}>Reintentar consulta</button>
  </div>
  return null
}
