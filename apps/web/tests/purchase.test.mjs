import test from 'node:test'
import assert from 'node:assert/strict'
import { decimal,scaled,normalizeCreate,estimatePurchase,buildPurchase,normalizeAction,matchesPurchaseResult,readPurchaseAttempt,savePurchaseAttempt,clearPurchaseAttempt } from '../src/features/purchases/purchase.logic.ts'
import { createPurchaseDraftStore,addPurchaseProduct } from '../src/features/purchases/purchase.draft.ts'
import { parsePurchase } from '../src/features/purchases/purchase.parse.ts'
import { parsePage,parseSupplier,parseSupplierDetail } from '../src/features/suppliers/supplier.parse.ts'
import { createPurchaseFixtureState,samplePurchaseInput,sampleSupplier } from './purchase-fixture-state.mjs'
import { startPurchaseFixture } from './purchase-browser-fixture.mjs'
import { randomUUID } from 'node:crypto'
const url=path=>new URL('http://fixture/api/v1'+path)
const product={id:'9007199254740993',empresa_id:'1',nombre:'Artículo',sku:'P-001',codigo_barras:'750001',tipo:'PRODUCTO',activo:true,controla_inventario:true,precio_venta:'999',unidad_medida:{activo:true,permite_decimales:false},impuestos:[]}
const draftLine=()=>({product,quantity:'2',price:'100',discount:'0',tax:'16',description:''})
const attempt=()=>({companyId:'1',userId:'3',key:randomUUID(),action:{kind:'create',body:normalizeCreate(samplePurchaseInput())}})
function fixture(scenario='normal') { const state=createPurchaseFixtureState();return {state,run:(method,path,input,key)=>state.handle(method,url(path),scenario,input,key)} }
function create(f) { const input=samplePurchaseInput(),result=f.run('POST','/purchases',input,randomUUID());assert.equal(result.status,201);return result.body.data.data }

test('compras: precisión por campo, sin exponentes ni límites monetarios perdidos',()=>{
  assert.equal(decimal('0001.2',4),'1.2000');assert.equal(scaled('1.2000',4),12000n)
  for(const [value,scale] of [['1e2',2],['-1',2],['',2],['1,2',2],['1.00001',4],['10000000000',4],['100000000000',3]]) assert.throws(()=>decimal(value,scale))
  assert.throws(()=>decimal('0',3,true));assert.equal(decimal('0',4),'0.0000')
})
test('compras: estimación reproduce redondeos del trigger por línea y descuento antes del impuesto',()=>{
  const input=normalizeCreate(samplePurchaseInput());assert.deepEqual(estimatePurchase(input.detalles),{subtotal:'200.00',descuento:'0.00',impuesto:'32.00',total:'232.00'})
  const line={...input.detalles[0],cantidad:'1.001',precio_unitario:'12.3456',descuento_porcentaje:'10.0000',tasa_impuesto:'16.0000'}
  assert.deepEqual(estimatePurchase([line]),{subtotal:'12.36',descuento:'1.24',impuesto:'1.78',total:'12.90'})
  assert.throws(()=>estimatePurchase([{...line,cantidad:'99999999999.999',precio_unitario:'9999999999.9999'}]))
})
test('compras: costo explícito, producto válido, enteros inventariables y servicios fraccionarios',()=>{
  const {detalles,...context}=samplePurchaseInput();void detalles
  const input=buildPurchase(context,[draftLine()],'1');assert.equal(input.detalles[0].precio_unitario,'100.0000');assert.equal('empresa_id' in input,false)
  for(const line of [{...draftLine(),price:''},{...draftLine(),quantity:'1.5'},{...draftLine(),product:{...product,empresa_id:'9'}},{...draftLine(),product:{...product,codigo_barras:null}},{...draftLine(),product:{...product,activo:false}}]) assert.throws(()=>buildPurchase(context,[line],'1'))
  assert.equal(buildPurchase(context,[{...draftLine(),quantity:'1.5',product:{...product,id:'40',tipo:'SERVICIO',controla_inventario:false,unidad_medida:{activo:true,permite_decimales:true}}}],'1').detalles[0].cantidad,'1.500')
})
test('compras: folio obligatorio, duplicados, porcentajes y campos limitados',()=>{
  const input=samplePurchaseInput()
  for(const patch of [{folio:''},{detalles:[]},{detalles:[input.detalles[0],input.detalles[0]]},{proveedor_id:'0'},{observaciones:'a'.repeat(2001)},{detalles:[{...input.detalles[0],tasa_impuesto:'100.0001'}]}])assert.throws(()=>normalizeCreate({...input,...patch}))
  assert.throws(()=>normalizeAction({kind:'cancel',purchaseId:'1',body:{motivo:''}}))
  assert.throws(()=>normalizeAction({kind:'pay',purchaseId:'1',body:{metodo_pago_id:'1',sesion_caja_id:null,monto:'0',referencia:null}}))
})
test('compras: captura conserva navegación y separa identidades; repetir producto no duplica la línea',()=>{
  const store=createPurchaseDraftStore();store.update('1:3',{folio:'LOCAL',lines:[draftLine()]});assert.equal(store.get('1:3').folio,'LOCAL');assert.equal(store.get('1:9').lines.length,0)
  const lines=addPurchaseProduct(store.get('1:3').lines,product);assert.equal(lines.length,1);assert.equal(lines[0].quantity,'3.000');assert.equal(lines[0].price,'100')
  assert.throws(()=>addPurchaseProduct([{...draftLine(),quantity:'1e2'}],product));store.clear();assert.equal(store.get('1:3').lines.length,0)
})
test('compras: protección conserva cuerpo canónico y clave; daño de almacenamiento bloquea',()=>{
  let value=null;const storage={getItem:()=>value,setItem:(_key,data)=>{value=data},removeItem:()=>{value=null}},input=attempt()
  assert.equal(readPurchaseAttempt(storage),null);savePurchaseAttempt(storage,input);assert.deepEqual(readPurchaseAttempt(storage),input)
  for(const raw of ['null','{}','{',JSON.stringify({...input,companyId:1}),JSON.stringify({...input,key:'otra'}),JSON.stringify({...input,action:{...input.action,body:{...input.action.body,empresa_id:'9'}}})]){value=raw;assert.equal(readPurchaseAttempt(storage),'unreadable')}
  assert.equal(readPurchaseAttempt({getItem:()=>{throw new Error('bloqueado')}}),'unreadable');clearPurchaseAttempt(storage);assert.equal(readPurchaseAttempt(storage),null)
})
test('compras: parser valida BIGINT, importes, saldos, relaciones y líneas sin duplicados',()=>{
  const f=fixture(),record=create(f);assert.equal(parsePurchase(record).id,record.id)
  for(const patch of [{id:Number(record.id)},{compra_detalle:null},{total:'231.99'},{resumen_financiero:{total_pagado:'1',saldo_pendiente:'231'}},{compra_detalle:[record.compra_detalle[0],record.compra_detalle[0]]},{proveedor:{...record.proveedor,id:'9'}}])assert.throws(()=>parsePurchase({...record,...patch}))
  assert.throws(()=>parsePurchase(record,'9'))
})
test('proveedores: lista, detalle y domicilios validan ámbito y datos',()=>{
  assert.equal(parseSupplier(sampleSupplier).id,sampleSupplier.id);assert.throws(()=>parseSupplier({...sampleSupplier,dias_credito:-1}))
  const f=fixture(),detail=f.run('GET','/suppliers/'+sampleSupplier.id).body.data;assert.equal(parseSupplierDetail(detail,sampleSupplier.id).proveedor_direccion.length,1)
  assert.throws(()=>parseSupplierDetail({...detail,proveedor_direccion:[{...detail.proveedor_direccion[0],proveedor_id:'9'}]},sampleSupplier.id))
  const list=f.run('GET','/suppliers?page=1&pageSize=20').body;assert.equal(parsePage(list,parseSupplier,1).total,2)
  assert.throws(()=>parsePage(list,parseSupplier,2))
})
test('compras: una respuesta consistente de otra solicitud no confirma el intento',()=>{
  const f=fixture(),record=parsePurchase(create(f)),action=attempt().action
  assert.equal(matchesPurchaseResult(action,record,'1','3'),true)
  for(const patch of [{usuario_id:'9'},{folio:'OTRO'},{observaciones:'otra'},{compra_detalle:[{...record.compra_detalle[0],precio_unitario:'99'}]}])assert.equal(matchesPurchaseResult(action,{...record,...patch},'1','3'),false)
})
test('simulador compras: recepción completa, cancelación y stock restaurado sin movimientos duplicados',()=>{
  const f=fixture(),row=create(f),key=randomUUID(),path='/purchases/'+row.id
  assert.equal(f.run('POST',path+'/receive',{},key).status,200);assert.equal(f.run('POST',path+'/receive',{},key).body.data.replayed,true)
  assert.equal(f.state.summary().scenarios[0].stock,12);assert.equal(f.state.summary().scenarios[0].movements.length,1)
  const cancelKey=randomUUID();assert.equal(f.run('POST',path+'/cancel',{motivo:'Prueba cancelada'},cancelKey).status,200);assert.equal(f.run('POST',path+'/cancel',{motivo:'Prueba cancelada'},cancelKey).body.data.replayed,true)
  assert.equal(f.state.summary().scenarios[0].stock,10);assert.equal(f.state.summary().scenarios[0].movements.length,2)
})
test('simulador compras: pagos parciales, efectivo, saldo y bloqueo de cancelación pagada',()=>{
  const f=fixture(),row=create(f),path='/purchases/'+row.id
  assert.equal(f.run('POST',path+'/payments',{metodo_pago_id:'1',sesion_caja_id:null,monto:'1',referencia:null},randomUUID()).status,409)
  f.run('POST',path+'/receive',{},randomUUID())
  const payment={metodo_pago_id:'2',sesion_caja_id:'6',monto:'100.00',referencia:'EFECTIVO-QA'},key=randomUUID()
  assert.equal(f.run('POST',path+'/payments',payment,key).status,201);assert.equal(f.run('POST',path+'/payments',payment,key).body.data.replayed,true)
  assert.equal(f.state.summary().scenarios[0].cash,'400.00');assert.equal(f.state.summary().scenarios[0].cashMovements,1)
  assert.equal(f.run('POST',path+'/payments',{...payment,monto:'133'},randomUUID()).status,422)
  assert.equal(f.run('POST',path+'/cancel',{motivo:'No permitida'},randomUUID()).status,409)
  const detail=parsePurchase(f.run('GET',path).body.data);assert.equal(detail.resumen_financiero.saldo_pendiente,'132.00')
})
test('simulador compras: clave reutilizada con otro cuerpo se rechaza y una respuesta perdida se recupera',()=>{
  const f=fixture('fault-create'),key=randomUUID(),input=samplePurchaseInput()
  assert.equal(f.run('POST','/purchases',input,key).status,503);assert.equal(f.run('POST','/purchases',input,key).body.data.replayed,true)
  assert.equal(f.run('POST','/purchases',{...input,folio:'OTRO'},key).status,409);assert.equal(f.state.summary().scenarios[0].purchases,1)
})
test('simulador compras: permisos y existencias insuficientes no registran cambios',()=>{
  for(const scenario of ['read-only','no-permission']){const f=fixture(scenario);assert.equal(f.run('POST','/purchases',samplePurchaseInput(),randomUUID()).status,403)}
  const f=fixture('stock-insufficient'),row=f.run('GET','/purchases').body.data.items[0]
  assert.equal(f.run('POST','/purchases/'+row.id+'/cancel',{motivo:'Prueba'},randomUUID()).status,409);assert.equal(f.state.summary().scenarios[0].operations,0)
})
test('HTTP aislado: cabecera Idempotency-Key, replay y respuesta anidada coinciden con el contrato',async()=>{
  const fixture=await startPurchaseFixture(0)
  try {
    const key=randomUUID(),options={method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture-normal','Idempotency-Key':key},body:JSON.stringify(samplePurchaseInput())}
    const first=await fetch(fixture.url+'/api/v1/purchases',options),body=await first.json();assert.equal(first.status,201);assert.equal(body.data.replayed,false);assert.equal(parsePurchase(body.data.data).total,'232.00')
    const replay=await(await fetch(fixture.url+'/api/v1/purchases',options)).json();assert.equal(replay.data.replayed,true);assert.equal(replay.data.data.id,body.data.data.id)
    assert.equal(fixture.stats().scenarios[0].purchases,1)
  }finally{await fixture.server.close()}
})
