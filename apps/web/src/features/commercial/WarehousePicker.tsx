import { useEffect, useMemo, useState } from 'react'
import { usePermission, useWarehouses } from './commercial.hooks'
import type { Warehouse } from './commercial.types'
import Pagination from './Pagination'
import QueryFeedback from './QueryFeedback'

export default function WarehousePicker({ value, onChange }: { value: Warehouse | null; onChange: (warehouse: Warehouse | null) => void }) {
  const allowed = usePermission('INVENTARIO.VER')
  const [page, setPage] = useState(1)
  const resource = useWarehouses(page, allowed)
  const rows = useMemo(() => resource.data?.items.filter((item) => item.activo && item.sucursal.activo) ?? [], [resource.data])
  useEffect(() => {
    if (!value && resource.status === 'success' && resource.data?.total === 1 && rows.length === 1) onChange(rows[0])
  }, [value, resource.status, resource.data, rows, onChange])
  const selectedInPage = rows.some((item) => item.id === value?.id)
  return <div className="commercial-picker">
    {!allowed && <p role="alert">Necesitas permiso para consultar inventario y seleccionar un almacén autorizado.</p>}
    <QueryFeedback resource={resource} />
    <label>Almacén y sucursal
      <select value={value?.id ?? ''} onChange={(event) => onChange(rows.find((item) => item.id === event.target.value) ?? null)}>
        <option value="">Selecciona un almacén</option>
        {value && !selectedInPage && <option value={value.id}>{value.sucursal.nombre} / {value.nombre}</option>}
        {rows.map((item) => <option key={item.id} value={item.id}>{item.sucursal.nombre} / {item.nombre}</option>)}
      </select>
    </label>
    {resource.data && resource.data.total > resource.data.size && <Pagination {...resource.data} onChange={setPage} />}
    {resource.status === 'success' && !rows.length && <p role="status">No hay almacenes activos disponibles en esta página.</p>}
  </div>
}
