import { useState } from 'react'
import { useAuthSession } from '../auth/useAuthSession'
import { usePermission } from '../commercial/commercial.hooks'
import type { Warehouse } from '../commercial/commercial.types'
import WarehousePicker from '../commercial/WarehousePicker'
import InventoryStockPanel,{InventoryAlertsPanel} from './InventoryStockPanel'
import InventoryAdjustmentForm from './InventoryAdjustmentForm'
import { InventoryKardex,InventoryMovements } from './InventoryLedger'
import InventoryTransfers from './InventoryTransfers'
import InventoryPending from './InventoryPending'
import { useInventoryMutation } from './useInventoryMutation'
import type { AdjustmentResult,InventoryStock } from './inventory.types'
import './inventory.css'
type Tab='stock'|'alerts'|'movements'|'kardex'|'transfers'
const tabs:[Tab,string][]=[['stock','Existencias'],['alerts','Alertas de stock'],['movements','Movimientos'],['kardex','Kardex'],['transfers','Traspasos']]
export default function InventoryWorkspace(){const auth=useAuthSession();return auth?<Workspace key={auth.accessToken}/>:null}
function Workspace(){
  const auth=useAuthSession()!,allowed=usePermission('INVENTARIO.VER'),canAdjust=usePermission('INVENTARIO.AJUSTAR'),canTransfer=usePermission('INVENTARIO.TRANSFERIR')
  const [warehouse,setWarehouse]=useState<Warehouse|null>(null),[tab,setTab]=useState<Tab>('stock'),[product,setProduct]=useState<InventoryStock|null>(null),[adjustment,setAdjustment]=useState<InventoryStock|null>(null),[revision,setRevision]=useState(0),[notice,setNotice]=useState(''),[lastAdjustment,setLastAdjustment]=useState<AdjustmentResult|null>(null),[transferId,setTransferId]=useState('')
  const mutation=useInventoryMutation(result=>{setRevision(value=>value+1);setAdjustment(null);if(result.kind==='adjust'){setLastAdjustment(result.adjustment);setProduct(null);setTab('stock');setNotice('Ajuste de inventario confirmado.')}else{if(!warehouse)setWarehouse(result.transfer.almacen_origen);setLastAdjustment(null);setTransferId(result.transfer.id);setTab('transfers');setNotice('Operación de traspaso confirmada: '+result.transfer.folio)}})
  if(!allowed)return <p role="alert">No tienes permiso para consultar inventario.</p>
  if(mutation.pending)return <InventoryPending mutation={mutation}/>
  const adjust=canAdjust&&warehouse?.activo&&warehouse.sucursal.activo?(row:InventoryStock)=>{setAdjustment(row);setNotice('')}:undefined
  const kardex=(row:InventoryStock)=>{setProduct(row);setTab('kardex')}
  return <>
    {notice&&<p className="commercial-notice" role="status">{notice}</p>}
    {lastAdjustment&&<section className="commercial-panel"><h2>Resultado del último ajuste</h2><dl className="inventory-totals"><dt>Cantidad anterior</dt><dd>{lastAdjustment.existencia_antes.cantidad}</dd><dt>Cantidad confirmada</dt><dd>{lastAdjustment.existencia_despues.cantidad}</dd><dt>Reservado</dt><dd>{lastAdjustment.existencia_despues.reservado}</dd><dt>Disponible</dt><dd>{lastAdjustment.existencia_despues.disponible}</dd><dt>Costo promedio confirmado</dt><dd>{lastAdjustment.existencia_despues.costo_promedio}</dd><dt>Sincronización solicitada</dt><dd>{lastAdjustment.sincronizacion.solicitada?lastAdjustment.sincronizacion.estado_al_crear:'No solicitada'}</dd></dl></section>}
    <section className="commercial-panel"><fieldset className="pos-fields" disabled={!!adjustment}><WarehousePicker value={warehouse} onChange={value=>{setWarehouse(value);setProduct(null);setAdjustment(null);setTransferId('');setLastAdjustment(null);setNotice('')}}/></fieldset></section>
    {!warehouse?<p>Selecciona un almacén para consultar y operar su inventario.</p>:adjustment?<InventoryAdjustmentForm stock={adjustment} error={mutation.error} onBack={()=>setAdjustment(null)} onConfirm={mutation.run}/>:<>
      <nav className="inventory-tabs" aria-label="Secciones de inventario">{tabs.map(([value,label])=><button key={value} type="button" aria-pressed={tab===value} onClick={()=>setTab(value)}>{label}</button>)}</nav>
      <div key={warehouse.id+':'+revision}>
        {tab==='stock'&&<InventoryStockPanel warehouseId={warehouse.id} revision={revision} onKardex={kardex} onAdjust={adjust}/>}
        {tab==='alerts'&&<InventoryAlertsPanel warehouseId={warehouse.id} revision={revision} onKardex={kardex} onAdjust={adjust}/>}
        {tab==='movements'&&<InventoryMovements warehouseId={warehouse.id} product={product} revision={revision} onClearProduct={()=>setProduct(null)}/>}
        {tab==='kardex'&&<InventoryKardex warehouseId={warehouse.id} product={product} revision={revision} onChoose={()=>setTab('stock')}/>}
        {tab==='transfers'&&<InventoryTransfers warehouse={warehouse} companyId={auth.user.empresa.id} canTransfer={canTransfer} initialId={transferId} onConfirm={mutation.run} error={mutation.error}/>}
      </div>
    </>}
  </>
}
