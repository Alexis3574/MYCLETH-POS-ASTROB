import { useEffect, useState } from 'react'
import { useAuthSession } from '../auth/useAuthSession'
import { useCash, useCurrentSession, usePermission } from '../commercial/commercial.hooks'
import type { CashRegister, CashSession } from '../commercial/commercial.types'
import Pagination from '../commercial/Pagination'
import QueryFeedback from '../commercial/QueryFeedback'

export interface CashChoice { register: CashRegister; session: CashSession }
export default function CashSessionPicker({ branchId, onSelect }: { branchId: string; onSelect?: (choice: CashChoice | null) => void }) {
  const allowed = usePermission('CAJAS.VER')
  const user = useAuthSession()?.user
  const [page, setPage] = useState(1)
  const [manual, setSelected] = useState<CashRegister | null>(null)
  const cash = useCash(branchId, page, allowed)
  const selected = manual ?? (cash.data?.total === 1 && cash.data.items[0]?.activo ? cash.data.items[0] : null)
  const current = useCurrentSession(selected?.id ?? '', allowed && !!selected?.activo)
  const usable = selected?.activo && selected.sucursal_id === branchId && current.data?.caja_id === selected.id && current.data?.estado === 'ABIERTA' && current.data.fecha_cierre === null && current.data.usuario_apertura_id === user?.id
  useEffect(() => {
    if (usable && selected && current.data) onSelect?.({ register: selected, session: current.data })
    else onSelect?.(null)
  }, [usable, selected, current.data, onSelect])
  return <div className="commercial-panel"><h2>Caja y sesión actual</h2>
    {!allowed && <p role="alert">No tienes permiso para consultar cajas. El efectivo requiere una sesión abierta.</p>}
    <QueryFeedback resource={cash} />
    <label>Caja<select value={selected?.id ?? ''} onChange={(event) => { setSelected(cash.data?.items.find((item) => item.id === event.target.value) ?? null); onSelect?.(null) }}>
      <option value="">Selecciona una caja</option>
      {selected && !cash.data?.items.some((item) => item.id === selected.id) && <option value={selected.id}>{selected.nombre}</option>}
      {cash.data?.items.map((item) => <option key={item.id} value={item.id} disabled={!item.activo}>{item.nombre} ({item.codigo}){!item.activo ? ' · Inactiva' : ''}</option>)}
    </select></label>
    {cash.data && cash.data.total > cash.data.size && <Pagination {...cash.data} onChange={setPage} />}
    <QueryFeedback resource={current} />
    {current.status === 'success' && <div className="commercial-notice">
      {current.data ? <><p>Sesión {current.data.id} · {current.data.estado}</p><p>Apertura: {current.data.monto_apertura}</p>
        {!usable && <p>Esta sesión no está disponible para registrar efectivo con tu usuario.</p>}</> : <p>Esta caja no tiene una sesión abierta.</p>}
      <button type="button" className="sales-button sales-button--secondary" onClick={() => { onSelect?.(null); current.refresh() }}>Actualizar sesión</button>
      {onSelect && usable && <p role="status">Sesión propia abierta seleccionada para efectivo.</p>}
    </div>}
    <p className="sales-muted">La apertura, el cierre y los movimientos manuales de caja se administran fuera de esta pantalla.</p>
  </div>
}
