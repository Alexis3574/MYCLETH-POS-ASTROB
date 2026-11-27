import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createCommercialFixture,startCommercialFixture,commercialUser } from './commercial-integrated-browser.mjs'
import { samplePurchaseInput } from './purchase-fixture-state.mjs'
import { inventoryProduct } from './inventory-advanced-fixture.mjs'
import { parseStock,parseKardex } from '../src/features/inventory/inventory.parse.ts'
import { parsePurchase } from '../src/features/purchases/purchase.parse.ts'
import { getVisibleNavigationSections } from '../src/app/navigation/navigation.config.ts'
const productId=inventoryProduct.id
function fixture(scenario='normal'){
  const state=createCommercialFixture(),run=(method,path,input=null,key=null)=>state.handle(method,new URL('http://fixture/api/v1'+path),scenario,input,key)
  return{state,run,stock:(warehouse='1')=>parseStock(run('GET',`/inventory/stock?almacen_id=${warehouse}&producto_id=${productId}`).body.data[0],warehouse),kardex:()=>parseKardex(run('GET',`/inventory/kardex?almacen_id=1&producto_id=${productId}`).body,'1',productId,1)}
}
function create(f,patch={}){const body=f.run('POST','/purchases',{...samplePurchaseInput(),...patch},randomUUID());assert.equal(body.status,201);return parsePurchase(body.body.data.data)}
const adjustment=(type,quantity)=>({almacen_id:'1',producto_id:productId,tipo:type,cantidad:quantity,costo_unitario:null,motivo:'Prueba conjunta',sincronizar_ecommerce:false})

test('conjunto: borrador no mueve stock; recibir afecta existencias, costo y kardex; cancelar conserva historial',()=>{
  const f=fixture(),input=samplePurchaseInput();input.detalles[0].precio_unitario='160.0000'
  const row=create(f,input);assert.equal(f.stock().cantidad,'10.000')
  assert.equal(f.run('POST',`/purchases/${row.id}/receive`,{},randomUUID()).status,200)
  assert.equal(f.stock().cantidad,'12.000');assert.equal(f.stock().reservado,'2.000');assert.equal(f.stock().disponible,'10.000');assert.equal(f.stock().costo_promedio,'110.0000')
  let ledger=f.kardex();assert.equal(ledger.resumen.saldo_base_reconstruido,'7.000');assert.equal(ledger.resumen.saldo_final_periodo,'12.000')
  const movements=f.run('GET',`/inventory/movements?almacen_id=1&producto_id=${productId}`).body.data
  assert.equal(movements.filter(item=>item.documento_id===row.id&&item.documento_tipo==='COMPRA').length,1)
  assert.equal(f.run('POST',`/purchases/${row.id}/cancel`,{motivo:'Revisión integrada'},randomUUID()).status,200)
  assert.equal(f.stock().cantidad,'10.000');assert.equal(f.stock().reservado,'2.000');assert.equal(f.stock().costo_promedio,'110.0000')
  ledger=f.kardex();assert.equal(ledger.resumen.saldo_base_reconstruido,'7.000');assert.equal(ledger.resumen.saldo_final_periodo,'10.000')
  assert.equal(f.state.summary().inventory.scenarios[0].events,2)
})
test('conjunto: ajuste reduce disponible y bloquea cancelación sin modificar documento, stock ni historial',()=>{
  const f=fixture(),row=create(f);f.run('POST',`/purchases/${row.id}/receive`,{},randomUUID())
  assert.equal(f.run('POST','/inventory/adjustments',adjustment('AJUSTE_NEGATIVO','9.000'),randomUUID()).status,201)
  const before=f.state.summary().inventory.scenarios[0]
  assert.equal(f.stock().disponible,'1.000')
  assert.equal(f.run('POST',`/purchases/${row.id}/cancel`,{motivo:'Sin disponible'},randomUUID()).status,409)
  assert.equal(f.run('GET',`/purchases/${row.id}`).body.data.estado,'RECIBIDA');assert.equal(f.stock().cantidad,'3.000')
  assert.deepEqual(f.state.summary().inventory.scenarios[0],before)
  f.run('POST','/inventory/adjustments',adjustment('AJUSTE_POSITIVO','9.000'),randomUUID())
  assert.equal(f.run('POST',`/purchases/${row.id}/cancel`,{motivo:'Disponible restaurado'},randomUUID()).status,200);assert.equal(f.stock().cantidad,'10.000')
})
test('conjunto: 503 de recepción y cancelación se recupera con misma clave sin duplicar movimientos ni eventos',()=>{
  for(const scenario of ['fault-receive','fault-cancel']){
    const f=fixture(scenario),row=f.run('GET','/purchases').body.data.items[0],action=scenario==='fault-receive'?'receive':'cancel',body=action==='receive'?{}:{motivo:'Recuperación integrada'},key=randomUUID()
    assert.equal(f.run('POST',`/purchases/${row.id}/${action}`,body,key).status,503)
    const before=structuredClone(f.state.summary().inventory.scenarios[0])
    assert.equal(f.run('POST',`/purchases/${row.id}/${action}`,body,key).body.data.replayed,true)
    assert.deepEqual(f.state.summary().inventory.scenarios[0],before)
    assert.equal(f.stock().cantidad,action==='receive'?'12.000':'10.000')
    assert.equal(f.run('POST',`/purchases/${row.id}/${action}`,{...body,motivo:'Contenido diferente'},key).status,409)
  }
})
test('conjunto: traspaso usa mercancía recibida y reserva de origen; cancelación de compra depende del disponible actual',()=>{
  const f=fixture(),row=create(f);f.run('POST',`/purchases/${row.id}/receive`,{},randomUUID())
  const created=f.run('POST','/transfers',{almacen_origen_id:'1',almacen_destino_id:'2',observaciones:null,detalles:[{producto_id:productId,cantidad:'9.000'}]},randomUUID())
  assert.equal(created.status,201);assert.equal(f.run('POST',`/transfers/${created.body.data.transferencia.id}/complete`,{},randomUUID()).status,200)
  assert.equal(f.stock().cantidad,'3.000');assert.equal(f.stock('2').cantidad,'13.000');assert.equal(f.stock().reservado,'2.000')
  assert.equal(f.run('POST',`/purchases/${row.id}/cancel`,{motivo:'Mercancía trasladada'},randomUUID()).status,409)
  assert.equal(f.kardex().resumen.saldo_base_reconstruido,'7.000');assert.equal(f.kardex().resumen.saldo_final_periodo,'3.000')
})
test('conjunto: pagos y servicios no crean movimientos de inventario adicionales; permisos bloquean ambos dominios',()=>{
  const f=fixture(),input=samplePurchaseInput();input.detalles.push({...input.detalles[0],producto_id:'40',cantidad:'0.500'})
  const row=create(f,input);f.run('POST',`/purchases/${row.id}/receive`,{},randomUUID())
  assert.equal(f.stock().cantidad,'12.000');const before=structuredClone(f.state.summary().inventory.scenarios[0])
  assert.equal(f.run('POST',`/purchases/${row.id}/payments`,{metodo_pago_id:'1',sesion_caja_id:null,monto:'10.00',referencia:null},randomUUID()).status,201)
  assert.deepEqual(f.state.summary().inventory.scenarios[0],before)
  assert.equal(f.run('POST',`/purchases/${row.id}/cancel`,{motivo:'Tiene pago'},randomUUID()).status,409)
  for(const scenario of ['read-only','no-permission']){
    const limited=fixture(scenario)
    assert.equal(limited.run('POST','/purchases',input,randomUUID()).status,403)
    assert.equal(limited.run('POST','/inventory/adjustments',adjustment('AJUSTE_POSITIVO','1.000'),randomUUID()).status,403)
    assert.equal(commercialUser(scenario).permisos.some(item=>item.codigo==='INVENTARIO.AJUSTAR'),false)
  }
})
test('HTTP conjunto: una dirección sirve ambos módulos, contrato de recepción y banner; sin rutas de escritura ajenas',async()=>{
  const fixture=await startCommercialFixture(0)
  try{
    const headers={Authorization:'Bearer fixture-normal','Content-Type':'application/json'}
    const request=(path,method='GET',body)=>fetch(fixture.url+'/api/v1'+path,{method,headers:{...headers,...(method==='POST'?{'Idempotency-Key':randomUUID()}:{})},...(body?{body:JSON.stringify(body)}:{})})
    const created=await(await request('/purchases','POST',samplePurchaseInput())).json(),id=created.data.data.id
    assert.equal((await request(`/purchases/${id}/receive`,'POST',{})).status,200)
    const stock=await(await request('/inventory/stock?almacen_id=1&producto_id='+productId)).json();assert.equal(stock.data[0].cantidad,'12.000')
    const ledger=await(await request('/inventory/kardex?almacen_id=1&producto_id='+productId)).json();assert.equal(ledger.resumen.saldo_final_periodo,'12.000')
    const products=await(await request('/products')).json();assert.deepEqual(products.data.map(item=>item.id),[productId,'40'])
    for(const page of ['/purchases','/inventory','/suppliers','/pos','/sales','/customers']){const html=await(await fetch(fixture.url+page)).text();assert.match(html,/Simulación conjunta/);assert.match(html,/Sin PostgreSQL real/)}
    assert.equal((await request('/unrelated','POST',{})).status,404)
    assert.equal((await fetch(fixture.url+'/__qa/commercial')).status,200)
  }finally{await fixture.server.close()}
})

function saleInput(quantity='1',patch={}){return{empresa_id:'1',sucursal_id:'2',almacen_id:'1',cliente_id:'8',sesion_caja_id:null,clave_idempotencia:randomUUID(),observaciones:'Prueba integrada POS',detalles:[{producto_id:productId,cantidad:quantity,descuento_porcentaje:'0'}],pagos:[{metodo_pago_id:'1',monto:(116*Number(quantity)).toFixed(2),referencia:null}],...patch}}
function sell(f,input=saleInput()){const result=f.run('POST','/sales',input);assert.equal(result.status,201);return result.body.data}
function returnInput(row,quantity,folio){return{folio,motivo:'Restituir piezas de prueba',sesion_caja_id:null,detalles:[{venta_detalle_id:row.detalles[0].id,cantidad:String(quantity)}],reembolsos:[{venta_pago_id:row.pagos[0].id,monto:(116*quantity).toFixed(2),referencia:null}]}}
test('conjunto: menú normal conserva POS, Ventas y Clientes además de Compras e Inventario; consulta no habilita escrituras',()=>{
  const paths=scenario=>getVisibleNavigationSections(commercialUser(scenario).permisos.map(item=>item.codigo)).flatMap(section=>section.items.map(item=>item.to))
  for(const path of ['/pos','/sales','/customers','/products','/inventory','/purchases','/suppliers','/cash'])assert.ok(paths('normal').includes(path),path)
  assert.ok(!paths('read-only').includes('/pos'));assert.ok(paths('read-only').includes('/sales'));assert.ok(paths('read-only').includes('/customers'))
  assert.deepEqual(paths('no-permission'),['/dashboard'])
  for(const scenario of ['read-only','no-permission']){
    const f=fixture(scenario)
    assert.equal(f.run('POST','/sales',saleInput()).status,403)
    assert.equal(f.run('PATCH','/sales/99/cancel',{}).status,403)
    assert.equal(f.run('POST','/sales/99/returns',{}).status,403)
  }
})
test('conjunto POS: compra recibida, venta con cliente y devoluciones parciales/totales comparten stock y kardex',()=>{
  const f=fixture(),purchase=create(f);f.run('POST',`/purchases/${purchase.id}/receive`,{},randomUUID())
  const input=saleInput('3'),sale=sell(f,input)
  assert.equal(sale.cliente.id,'8');assert.equal(f.stock().cantidad,'9.000');assert.equal(f.stock().disponible,'7.000')
  assert.equal(f.run('GET','/sales').body.data[0].id,sale.id);assert.equal(f.run('GET','/customers?q=prueba&activo=true').body.data.items[0].id,'8')
  const beforeReplay=structuredClone(f.state.summary().inventory.scenarios[0])
  assert.equal(f.run('POST','/sales',input).status,200);assert.deepEqual(f.state.summary().inventory.scenarios[0],beforeReplay)
  assert.equal(f.run('GET','/sales/operations/'+input.clave_idempotencia).body.data.id,sale.id)
  assert.equal(f.run('POST',`/sales/${sale.id}/returns`,returnInput(sale,1,'DEV-INTEGRADA-1')).status,201);assert.equal(f.stock().cantidad,'10.000')
  assert.equal(f.run('POST',`/sales/${sale.id}/returns`,returnInput(sale,2,'DEV-INTEGRADA-2')).status,201);assert.equal(f.stock().cantidad,'12.000');assert.equal(f.stock().reservado,'2.000')
  assert.equal(f.run('GET',`/sales/${sale.id}/financial-summary`).body.data.resumen.total_neto_venta,0)
  assert.equal(f.run('PATCH',`/sales/${sale.id}/cancel`,{}).status,409)
  const ledger=f.kardex();assert.equal(ledger.resumen.saldo_base_reconstruido,'7.000');assert.equal(ledger.resumen.saldo_final_periodo,'12.000')
  const movements=f.run('GET','/inventory/movements?almacen_id=1').body.data
  assert.equal(movements.filter(row=>row.documento_tipo==='VENTA').length,1);assert.equal(movements.filter(row=>row.documento_tipo==='DEVOLUCION_VENTA').length,2)
})
test('conjunto POS: cancelar venta restaura stock una vez y devuelve su costo original al promedio ponderado',()=>{
  const f=fixture(),sale=sell(f,saleInput('2'));assert.equal(f.stock().cantidad,'8.000')
  const input=samplePurchaseInput();input.detalles[0].precio_unitario='150.0000';const purchase=create(f,input);f.run('POST',`/purchases/${purchase.id}/receive`,{},randomUUID())
  assert.equal(f.stock().costo_promedio,'110.0000')
  assert.equal(f.run('PATCH',`/sales/${sale.id}/cancel`,{}).status,200)
  assert.equal(f.stock().cantidad,'12.000');assert.equal(f.stock().costo_promedio,'108.3333')
  const before=structuredClone(f.state.summary().inventory.scenarios[0]);assert.equal(f.run('PATCH',`/sales/${sale.id}/cancel`,{}).status,409);assert.deepEqual(f.state.summary().inventory.scenarios[0],before)
  assert.equal(f.run('GET',`/sales/${sale.id}/financial-summary`).body.data.resumen.total_neto_venta,0)
  assert.equal(f.kardex().resumen.saldo_final_periodo,'12.000')
})
test('conjunto POS: servidor respeta disponible compartido, rechaza lotes y reembolsos inválidos sin efectos parciales',()=>{
  const f=fixture();assert.equal(f.run('POST','/sales',saleInput('9')).status,422)
  assert.equal(f.state.summary().sales[0].sales,0);assert.equal(f.stock().cantidad,'10.000')
  const purchase=create(f);f.run('POST',`/purchases/${purchase.id}/receive`,{},randomUUID());const sale=sell(f,saleInput('9'))
  assert.equal(f.stock().cantidad,'3.000');assert.equal(f.stock().reservado,'2.000')
  assert.equal(f.run('POST',`/purchases/${purchase.id}/cancel`,{motivo:'Stock vendido'},randomUUID()).status,409)
  const before=structuredClone(f.state.summary().inventory.scenarios[0]),invalid=returnInput(sale,1,'DEV-MONTO-INVALIDO');invalid.reembolsos[0].monto='115.00'
  assert.equal(f.run('POST',`/sales/${sale.id}/returns`,invalid).status,422);assert.deepEqual(f.state.summary().inventory.scenarios[0],before)
  assert.equal(f.run('GET',`/sales/${sale.id}/returns`).body.data.devoluciones.length,0)
  assert.equal(f.run('POST',`/sales/${sale.id}/returns`,returnInput(sale,1,'DEV-LIBERA')).status,201)
  assert.equal(f.run('POST',`/purchases/${purchase.id}/cancel`,{motivo:'Disponible liberado'},randomUUID()).status,200)
  assert.equal(f.stock().cantidad,'2.000');assert.equal(f.stock().disponible,'0.000')
})
