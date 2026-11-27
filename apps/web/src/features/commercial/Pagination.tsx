export default function Pagination({ page, size, total, onChange }: { page: number; size: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.ceil(total / size)
  return <nav className="commercial-pagination" aria-label="Paginación de resultados">
    <span aria-live="polite">{total} resultados · Página {page} de {Math.max(1, pages)}</span>
    <button type="button" className="sales-button sales-button--secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</button>
    <button type="button" className="sales-button sales-button--secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>Siguiente</button>
  </nav>
}
