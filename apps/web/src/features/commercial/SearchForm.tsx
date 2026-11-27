import { useId, useState } from 'react'

export default function SearchForm({ label, onSearch, onlyActive = false }: { label: string; onSearch: (text: string, active: string) => void; onlyActive?: boolean }) {
  const id = useId()
  const [text, setText] = useState('')
  const [active, setActive] = useState('true')
  return <form className="commercial-search" onSubmit={(event) => { event.preventDefault(); onSearch(text.trim(), active) }}>
    <label htmlFor={id}>{label}<input id={id} type="search" maxLength={180} value={text} onChange={(event) => setText(event.target.value)} /></label>
    {!onlyActive && <label>Estado<select value={active} onChange={(event) => setActive(event.target.value)}>
      <option value="true">Activos</option><option value="false">Inactivos</option><option value="">Todos</option>
    </select></label>}
    <button type="submit" className="sales-button">Buscar</button>
    <button type="button" className="sales-button sales-button--secondary" onClick={() => { setText(''); setActive('true'); onSearch('', 'true') }}>Limpiar</button>
  </form>
}
