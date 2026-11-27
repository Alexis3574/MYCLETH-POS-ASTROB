import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { normalizeAdjustment,validateAdjustment,normalizeTransfer,normalizeInventoryAction,dateBounds,inventoryAlerts,scanInventoryAlerts,signedUnits,readInventoryAttempt,saveInventoryAttempt,clearInventoryAttempt } from '../src/features/inventory/inventory.logic.ts'
import { parseStock,parseInventoryPage,parseKardex,parseAdjustmentResult,parseTransferResult,parseTransferDetail } from '../src/features/inventory/inventory.parse.ts'
import { createInventoryFixture,inventoryProduct } from './inventory-advanced-fixture.mjs'
import { startInventoryFixture } from './inventory-advanced-browser.mjs'
const url=path=>new URL('http://fixture/api/v1'+path)
const adjustment=(patch={})=>normalizeAdjustment({almacen_id:'1',producto_id:inventoryProduct.id,tipo:'AJUSTE_POSITIVO',cantidad:'2',costo_unitario:null,motivo:'Conteo de prueba',sincronizar_ecommerce:true,...patch})
const transferInput=(patch={})=>normalizeTransfer({almacen_origen_id:'1',almacen_destino_id:'2',observaciones:null,detalles:[{producto_id:inventoryProduct.id,cantidad:'3'}],...patch})
const attempt=action=>({companyId:'1',userId:'3',key:randomUUID(),action:normalizeInventoryAction(action)})
function fixture(scenario='normal'){const state=createInventoryFixture();return{state,run:(method,path,input=null,key=null)=>state.handle(method,url(path),scenario,input,key)}}
function getStock(f,id=inventoryProduct.id,warehouse='1'){return f.run('GET','/inventory/stock?almacen_id='+warehouse+'&producto_id='+id).body.data[0]}
function create(f,input=transferInput()){const pending=attempt({kind:'create-transfer',body:input}),response=f.run('POST','/transfers',pending.action.body,pending.key);assert.equal(response.status,201);return{pending,response,id:response.body.data.transferencia.id}}

test('inventario: ajustes normalizados, signo por tipo y precisión estricta',()=>{
  assert.equal(adjustment().cantidad,'2.000');assert.equal(signedUnits('-0.125'),-125n)
  for(const patch of [{cantidad:'0'},{cantidad:'1e2'},{cantidad:'1.0001'},{cantidad:'-1'},{tipo:'SALIDA'},{tipo:'AJUSTE_NEGATIVO',costo_unitario:'1'},{cantidad:'1.5'},{motivo:''},{almacen_id:'0'}])assert.throws(()=>adjustment(patch))
  assert.equal(adjustment({cantidad:'0.125',sincronizar_ecommerce:false}).cantidad,'0.125')
})
test('inventario: los ajustes respetan reservas, unidad, código y límites',()=>{
  const f=fixture(),stock=parseStock(getStock(f),'1')
  assert.equal(validateAdjustment(adjustment(),stock).cantidad,'2.000')
  assert.throws(()=>validateAdjustment(adjustment({tipo:'AJUSTE_NEGATIVO',cantidad:'9'}),stock))
  assert.throws(()=>validateAdjustment(adjustment({cantidad:'1.5',sincronizar_ecommerce:false}),stock))
  assert.throws(()=>validateAdjustment(adjustment(),{...stock,producto:{...stock.producto,codigo_barras:null}}))
  assert.throws(()=>validateAdjustment(adjustment({cantidad:'99999999999.999',sincronizar_ecommerce:false}),stock))
})
test('inventario: alertas usan disponible para mínimo y cantidad para máximo, sin registro no se oculta',()=>{
  const f=fixture(),stock=parseStock(getStock(f),'1')
  assert.deepEqual(inventoryAlerts(stock),[])
  assert.deepEqual(inventoryAlerts({...stock,cantidad:'13.000',reservado:'9.000',disponible:'4.000',bajo_minimo:true}),['Bajo mínimo','Sobre máximo'])
  assert.deepEqual(inventoryAlerts(parseStock(getStock(f,'43'),'1')),['Agotado','Bajo mínimo','Sin existencia registrada'])
})
test('inventario: alertas recorren todas las páginas y no afirman completitud con catálogo cambiante',async()=>{
  const f=fixture('paged-alerts'),pages=[]
  const result=await scanInventoryAlerts(async page=>{pages.push(page);return parseInventoryPage(f.run('GET',`/inventory/stock?almacen_id=1&page=${page}&limit=100`).body,row=>parseStock(row,'1'),page,100)})
  assert.deepEqual(pages,[1,2]);assert.equal(result.reviewed,102);assert.equal(result.items.length,1);assert.equal(result.items[0].producto.sku,'PAGE-101')
  await assert.rejects(scanInventoryAlerts(async page=>({items:[],total:page===1?2:3,page,size:100})))
  await assert.rejects(scanInventoryAlerts(async page=>({items:[result.items[0]],total:2,page,size:1})))
})
test('inventario: kardex conserva base reconstruida y saldos firmados sin perder BIGINT',()=>{
  const f=fixture(),body=f.run('GET','/inventory/kardex?almacen_id=1&producto_id='+inventoryProduct.id).body,result=parseKardex(body,'1',inventoryProduct.id,1)
  assert.equal(result.resumen.saldo_base_reconstruido,'7.000');assert.equal(result.resumen.saldo_final_periodo,'10.000');assert.equal(result.rows[0].saldo_antes,'7.000')
  assert.throws(()=>parseKardex({...body,resumen:{...body.resumen,saldo_final_periodo:'11.000'}},'1',inventoryProduct.id,1))
  assert.throws(()=>parseKardex({...body,data:[{...body.data[0],delta:'-3.000'}]},'1',inventoryProduct.id,1))
})
test('inventario: rango UTC comprueba fechas reales, orden y límites independientes',()=>{
  assert.deepEqual(dateBounds('2026-11-22',''),{fecha_desde:'2026-11-22T00:00:00.000Z'})
  assert.equal(dateBounds('','2026-11-22').fecha_hasta,'2026-11-22T23:59:59.999Z')
  for(const values of [['2026-02-30',''],['2026-11-23','2026-11-22'],['22/11/2026','']])assert.throws(()=>dateBounds(...values))
})
test('inventario: parser rechaza stock incoherente, almacén ajeno y paginación incorrecta',()=>{
  const f=fixture(),row=getStock(f)
  assert.equal(parseStock(row,'1').producto.id,inventoryProduct.id)
  for(const patch of [{disponible:'99.000'},{bajo_minimo:true},{stock_minimo:5},{unidad:{...row.unidad,permite_decimales:null}}])assert.throws(()=>parseStock({...row,...patch},'1'))
  assert.throws(()=>parseStock(row,'2'))
  assert.throws(()=>parseInventoryPage(f.run('GET','/inventory/stock?almacen_id=1').body,item=>parseStock(item,'1'),2))
})
test('inventario: persistencia bloquea datos dañados y conserva cuerpo y clave',()=>{
  let raw=null;const storage={getItem:()=>raw,setItem:(_key,value)=>{raw=value},removeItem:()=>{raw=null}},pending=attempt({kind:'adjust',body:adjustment()})
  assert.equal(readInventoryAttempt(storage),null);saveInventoryAttempt(storage,pending);assert.deepEqual(readInventoryAttempt(storage),pending)
  for(const value of ['{}','{','null',JSON.stringify({...pending,userId:3}),JSON.stringify({...pending,key:'otra'}),JSON.stringify({...pending,action:{...pending.action,body:{...pending.action.body,usuario_id:'9'}}})]){raw=value;assert.equal(readInventoryAttempt(storage),'unreadable')}
  assert.equal(readInventoryAttempt({getItem:()=>{throw new Error('bloqueado')}}),'unreadable');clearInventoryAttempt(storage);assert.equal(readInventoryAttempt(storage),null)
})
test('inventario: respuesta de ajuste debe corresponder a usuario, clave, cantidades y reservas',()=>{
  const f=fixture(),pending=attempt({kind:'adjust',body:adjustment()}),response=f.run('POST','/inventory/adjustments',pending.action.body,pending.key).body
  assert.equal(parseAdjustmentResult(response,pending).existencia_despues.cantidad,'12.000')
  for(const patch of [{usuario_id:'9'},{clave_idempotencia:randomUUID()},{cantidad:'3.000'},{existencia_despues:{...response.data.existencia_despues,cantidad:'13.000',disponible:'11.000'}}])assert.throws(()=>parseAdjustmentResult({...response,data:{...response.data,...patch}},pending))
})
test('simulador inventario: positivo y negativo restauran cantidades y reservas; replay no crea eventos repetidos',()=>{
  const f=fixture(),pending=attempt({kind:'adjust',body:adjustment()})
  assert.equal(f.run('POST','/inventory/adjustments',pending.action.body,pending.key).status,201)
  assert.equal(f.run('POST','/inventory/adjustments',pending.action.body,pending.key).body.replayed,true)
  const negative=attempt({kind:'adjust',body:adjustment({tipo:'AJUSTE_NEGATIVO'})});assert.equal(f.run('POST','/inventory/adjustments',negative.action.body,negative.key).status,201)
  const stock=getStock(f);assert.equal(stock.cantidad,'10.000');assert.equal(stock.reservado,'2.000');assert.equal(stock.disponible,'8.000');assert.equal(f.state.summary().scenarios[0].events,2);assert.equal(f.state.summary().scenarios[0].movements,3)
})
test('simulador inventario: cantidad fraccionaria sin sincronización y sin código admitida por unidad',()=>{
  const f=fixture(),pending=attempt({kind:'adjust',body:adjustment({producto_id:'42',cantidad:'0.125',sincronizar_ecommerce:false})})
  assert.equal(f.run('POST','/inventory/adjustments',pending.action.body,pending.key).status,201);assert.equal(getStock(f,'42').cantidad,'1.375');assert.equal(f.state.summary().scenarios[0].events,0)
})
test('traspasos: almacenes distintos, detalle único y cantidades positivas; folio automático opcional',()=>{
  assert.equal('folio' in transferInput(),false)
  for(const patch of [{almacen_destino_id:'1'},{detalles:[]},{detalles:[{producto_id:inventoryProduct.id,cantidad:'0'}]},{detalles:[{producto_id:inventoryProduct.id,cantidad:'1'},{producto_id:inventoryProduct.id,cantidad:'2'}]},{folio:''}])assert.throws(()=>transferInput(patch))
})
test('simulador traspasos: crear no mueve stock; completar registra el par, conserva reservas y calcula costo destino',()=>{
  const f=fixture(),created=create(f),pending=attempt({kind:'complete-transfer',id:created.id,body:{}})
  assert.equal(parseTransferResult(created.response.body,created.pending).estado,'BORRADOR');assert.equal(getStock(f).cantidad,'10.000')
  const response=f.run('POST','/transfers/'+created.id+'/complete',{},pending.key)
  assert.equal(response.status,200);assert.equal(parseTransferResult(response.body,pending).estado,'COMPLETADA')
  assert.equal(getStock(f).cantidad,'7.000');assert.equal(getStock(f).reservado,'2.000');assert.equal(getStock(f,inventoryProduct.id,'2').cantidad,'7.000');assert.equal(getStock(f,inventoryProduct.id,'2').costo_promedio,'71.4286')
  assert.equal(f.run('POST','/transfers/'+created.id+'/complete',{},pending.key).body.replayed,true);assert.equal(f.state.summary().scenarios[0].movements,3);assert.equal(f.state.summary().scenarios[0].events,0)
  assert.equal(parseTransferDetail(f.run('GET','/transfers/'+created.id).body.data,created.id).movimientos.length,2)
  assert.equal(f.run('POST','/transfers/'+created.id+'/cancel',{motivo:'No permitida'},randomUUID()).status,409)
})
test('traspasos: respuesta incompleta o de otra operación no confirma traslado',()=>{
  const f=fixture(),created=create(f),pending=attempt({kind:'complete-transfer',id:created.id,body:{}}),body=f.run('POST','/transfers/'+created.id+'/complete',{},pending.key).body
  assert.throws(()=>parseTransferResult({...body,data:{...body.data,movimientos:body.data.movimientos.slice(0,1)}},pending))
  assert.throws(()=>parseTransferResult({...body,data:{...body.data,operacion:{...body.data.operacion,usuario_id:'9'}}},pending))
  const wrongCost=structuredClone(body);wrongCost.data.existencias[0].destino.despues.costo_promedio='72.0000';assert.throws(()=>parseTransferResult(wrongCost,pending))
})
test('simulador traspasos: cancelar borrador no mueve inventario y completar sin disponible no tiene efectos parciales',()=>{
  const f=fixture(),created=create(f),pending=attempt({kind:'cancel-transfer',id:created.id,body:{motivo:'No se enviará'}})
  assert.equal(parseTransferResult(f.run('POST','/transfers/'+created.id+'/cancel',pending.action.body,pending.key).body,pending).estado,'CANCELADA');assert.equal(getStock(f).cantidad,'10.000');assert.equal(f.state.summary().scenarios[0].movements,1)
  const other=create(f,transferInput({folio:'EXCESO',detalles:[{producto_id:inventoryProduct.id,cantidad:'9'}]}));assert.equal(f.run('POST','/transfers/'+other.id+'/complete',{},randomUUID()).status,409);assert.equal(getStock(f).cantidad,'10.000');assert.equal(getStock(f,inventoryProduct.id,'2').cantidad,'4.000')
})
test('simulador inventario: 503 después de ajustar o crear se recupera con misma clave, sin duplicados',()=>{
  for(const kind of ['adjust','create']){const f=fixture('fault-'+kind),pending=attempt(kind==='adjust'?{kind:'adjust',body:adjustment()}:{kind:'create-transfer',body:transferInput()}),path=kind==='adjust'?'/inventory/adjustments':'/transfers';assert.equal(f.run('POST',path,pending.action.body,pending.key).status,503);assert.equal(f.run('POST',path,pending.action.body,pending.key).body.replayed,true);assert.equal(f.state.summary().scenarios[0].operations,1);assert.equal(f.run('POST',path,{...pending.action.body,motivo:'Otro'},pending.key).status,409)}
})
test('simulador inventario: permisos y acceso a almacenes se verifican antes de escribir',()=>{
  for(const scenario of ['read-only','no-permission']){const f=fixture(scenario);assert.equal(f.run('POST','/inventory/adjustments',adjustment(),randomUUID()).status,403)}
  const f=fixture('limited');assert.equal(f.run('GET','/inventory/stock?almacen_id=2').status,404);assert.equal(f.run('POST','/transfers',transferInput(),randomUUID()).status,404);assert.equal(f.state.summary().scenarios[0].operations,0)
})
test('HTTP aislado inventario: cabecera y contrato plano de idempotencia, sin PostgreSQL',async()=>{
  const fixture=await startInventoryFixture(0)
  try{const key=randomUUID(),options={method:'POST',headers:{Authorization:'Bearer fixture-normal','Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(adjustment())},response=await fetch(fixture.url+'/api/v1/inventory/adjustments',options),body=await response.json();assert.equal(response.status,201);assert.equal(body.replayed,false);assert.equal(body.data.existencia_despues.cantidad,'12.000');const replay=await(await fetch(fixture.url+'/api/v1/inventory/adjustments',options)).json();assert.equal(replay.replayed,true);assert.equal(replay.data.ajuste_id,body.data.ajuste_id)}finally{await fixture.server.close()}
})
