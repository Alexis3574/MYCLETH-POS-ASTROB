import test from 'node:test'
import assert from 'node:assert/strict'
import { createCommercialFixture,commercialUser,startCommercialFixture } from './commercial-integrated-browser.mjs'
import { parseDocument,normalizeLines,calendar,documentActions,identifier } from '../src/features/quotations/document.logic.ts'
import { parseUser,parseRole,parsePermission,parseArray,userInput,roleInput,validatePassword } from '../src/features/users/access.logic.ts'
import { creditSummary } from '../src/features/credits/credit.logic.ts'
import { getVisibleNavigationSections } from '../src/app/navigation/navigation.config.ts'
const product='9007199254740993',url=path=>new URL('http://fixture/api/v1'+path)
const input=(patch={})=>({sucursal_id:'2',cliente_id:'8',folio:'DOC-QA',observaciones:null,detalles:[{producto_id:product,cantidad:'2.000',descuento_porcentaje:'0.0000',descripcion:'Partida QA'}],...patch})
function fixture(scenario='normal'){const state=createCommercialFixture(),run=(method,path,body=null)=>state.handle(method,url(path),scenario,body);return{state,run,stock:()=>run('GET','/inventory/stock?almacen_id=1&producto_id='+product).body.data[0]}}
function create(f,kind='quotes',patch={}){const result=f.run('POST','/'+kind,input(patch));assert.equal(result.status,201);parseDocument(result.body.data,kind,'1');return result.body.data}
function accepted(f){const row=create(f);assert.equal(f.run('POST',`/quotes/${row.id}/send`,{}).status,200);assert.equal(f.run('POST',`/quotes/${row.id}/accept`,{}).status,200);return row}
function ready(f,kind,row){for(const action of kind==='sales-orders'?['start','ready']:['confirm','prepare','ready'])assert.equal(f.run('POST',`/${kind}/${row.id}/${action}`,{}).status,200)}
const conversion=(folio='SALE-DOC',amount='232.00')=>({folio,almacen_id:'1',sesion_caja_id:null,pagos:[{metodo_pago_id:'1',monto:amount,referencia:null}],observaciones:null})

test('documentos: normalización exacta, BIGINT, fechas reales y duplicados',()=>{
 assert.equal(normalizeLines(input().detalles)[0].cantidad,'2.000');assert.equal(identifier(product),product)
 for(const value of ['0','9223372036854775808','1e3'])assert.throws(()=>identifier(value))
 for(const value of ['2026-02-30','2026-13-01','23/11/2026'])assert.throws(()=>calendar(value))
 assert.equal(calendar(''),null);assert.equal(calendar('2028-02-29'),'2028-02-29')
 for(const details of [[],[input().detalles[0],input().detalles[0]],[{...input().detalles[0],cantidad:'1e2'}],[{...input().detalles[0],descuento_porcentaje:'100.0001'}]])assert.throws(()=>normalizeLines(details))
})
test('documentos: parser comprueba empresa, importes, cliente, fecha y partidas sin duplicados',()=>{
 const f=fixture(),row=create(f,'quotes',{detalles:[{...input().detalles[0],descuento_porcentaje:'10.0000'}]});assert.equal(parseDocument(row,'quotes','1').total,'208.80')
 for(const patch of [{empresa_id:'2'},{total:'209.00'},{sucursal_id:'3'},{valida_hasta:'2026-02-30'},{cotizacion_detalle:[row.cotizacion_detalle[0],row.cotizacion_detalle[0]]}])assert.throws(()=>parseDocument({...row,...patch},'quotes','1'))
 const order=create(f,'customer-orders');assert.throws(()=>parseDocument({...order,cliente_id:null,cliente:null},'customer-orders','1'))
})
test('cotizaciones: borradores editables, estados propios y sin efectos de stock',()=>{
 const f=fixture();f.stock();const row=create(f)
 assert.equal(f.run('PATCH','/quotes/'+row.id,{observaciones:'Editada',detalles:[{...input().detalles[0],cantidad:'3.000'}]}).body.data.total,'348.00')
 assert.equal(f.run('POST',`/quotes/${row.id}/accept`,{}).status,409)
 assert.equal(f.run('POST',`/quotes/${row.id}/send`,{}).body.data.estado,'ENVIADA')
 assert.equal(f.run('PATCH','/quotes/'+row.id,{observaciones:'No editable'}).status,409)
 assert.equal(f.run('POST',`/quotes/${row.id}/reject`,{}).body.data.estado,'RECHAZADA')
 assert.equal(f.stock().cantidad,'10.000');assert.equal(f.state.summary().inventory.scenarios[0].movements,1)
 assert.deepEqual(documentActions('customer-orders','CONFIRMADO').map(row=>row[0]),['prepare','cancel'])
 assert.deepEqual(documentActions('sales-orders','EN_PROCESO').map(row=>row[0]),['ready','cancel'])
})
test('cotización a orden conserva cliente y partidas; mismo folio retorna orden sin duplicar',()=>{
 const f=fixture(),quote=accepted(f),result=f.run('POST',`/quotes/${quote.id}/convert-to-order`,{folio:'ORD-QA',fecha_compromiso:null,observaciones:null});assert.equal(result.status,201)
 const order=result.body.data;assert.equal(order.cotizacion_id,quote.id);assert.equal(order.total,quote.total);assert.equal(order.cliente_id,quote.cliente_id)
 const count=f.state.summary().workflows.scenarios[0].operations
 assert.equal(f.run('POST',`/quotes/${quote.id}/convert-to-order`,{folio:'ORD-QA'}).body.data.id,order.id);assert.equal(f.state.summary().workflows.scenarios[0].operations,count)
 assert.equal(f.run('POST',`/quotes/${quote.id}/convert-to-order`,{folio:'OTRA'}).status,409)
 assert.equal(f.run('PATCH','/sales-orders/'+order.id,{cliente_id:null}).status,409)
 assert.equal(f.run('PATCH','/sales-orders/'+order.id,{observaciones:'Compromiso editado'}).status,200)
})
test('orden a venta usa inventario compartido y evita segunda conversión incluso tras cancelar venta',()=>{
 const f=fixture(),order=create(f,'sales-orders');assert.equal(f.run('POST',`/sales-orders/${order.id}/convert-to-sale`,conversion()).status,409);ready(f,'sales-orders',order)
 const result=f.run('POST',`/sales-orders/${order.id}/convert-to-sale`,conversion());assert.equal(result.status,201);assert.equal(result.body.data.orden_venta_id,order.id);assert.equal(f.stock().cantidad,'8.000')
 assert.equal(f.run('GET','/sales-orders/'+order.id).body.data.estado,'LISTA')
 assert.equal(f.run('POST',`/sales-orders/${order.id}/convert-to-sale`,conversion('SECOND')).status,409);assert.equal(f.stock().cantidad,'8.000')
 f.run('PATCH','/sales/'+result.body.data.id+'/cancel',{});assert.equal(f.stock().cantidad,'10.000')
 assert.equal(f.run('POST',`/sales-orders/${order.id}/cancel`,{}).status,409)
 assert.equal(f.run('POST',`/sales-orders/${order.id}/convert-to-sale`,conversion('THIRD')).status,409)
})
test('pedidos: cliente requerido, preparación/entrega y conversión sin facturación artificial',()=>{
 const f=fixture();assert.equal(f.run('POST','/customer-orders',input({cliente_id:null})).status,400)
 const row=create(f,'customer-orders');assert.equal(f.run('POST',`/customer-orders/${row.id}/ready`,{}).status,409);ready(f,'customer-orders',row)
 const result=f.run('POST',`/customer-orders/${row.id}/convert-to-sale`,conversion('PED-SALE'));assert.equal(result.status,201);assert.equal(result.body.data.pedido_cliente_id,row.id)
 assert.equal(f.run('GET','/customer-orders/'+row.id).body.data.estado,'LISTO');assert.equal(f.stock().cantidad,'8.000')
 assert.equal(f.run('POST',`/customer-orders/${row.id}/deliver`,{}).body.data.estado,'ENTREGADO')
 assert.equal(f.run('POST',`/customer-orders/${row.id}/cancel`,{}).status,409)
})
test('conversión rechaza pagos inexactos, almacén de otra sucursal y falta de disponible sin efectos',()=>{
 const f=fixture(),row=create(f,'sales-orders');ready(f,'sales-orders',row)
 assert.equal(f.run('POST',`/sales-orders/${row.id}/convert-to-sale`,conversion('BAD-PAY','1.00')).status,422)
 assert.equal(f.run('POST',`/sales-orders/${row.id}/convert-to-sale`,{...conversion(),almacen_id:'2'}).status,422)
 const excessive=create(f,'sales-orders',{folio:'EXCESO',detalles:[{...input().detalles[0],cantidad:'9.000'}]});ready(f,'sales-orders',excessive)
 assert.equal(f.run('POST',`/sales-orders/${excessive.id}/convert-to-sale`,conversion('NO-STOCK','1044.00')).status,422)
 assert.equal(f.stock().cantidad,'10.000');assert.equal(f.state.summary().workflows.scenarios[0].linkedSales,0)
})
test('documentos: 503 tras registrar permite consultar por folio sin un segundo POST',()=>{
 const f=fixture('workflow-fault'),result=f.run('POST','/quotes',input());assert.equal(result.status,503)
 const found=f.run('GET','/quotes?q=DOC-QA&page=1&pageSize=20');assert.equal(found.body.data.rows.length,1);assert.equal(f.state.summary().workflows.scenarios[0].operations,1)
})
test('administración: alta/edición, contraseña sin persistencia y control de duplicados',()=>{
 const f=fixture(),password='SoloFixture-2026',result=f.run('POST','/users',{empresa_id:'1',username:'operador-qa',nombre:'Operador QA',password});assert.equal(result.status,201)
 const user=parseUser(result.body.data);assert.equal('password' in result.body.data,false);assert.equal(f.run('PATCH','/users/'+user.id,{nombre:'Actualizado',activo:false}).body.data.activo,false)
 const changed=f.run('PATCH','/users/'+user.id+'/password',{password});assert.equal(changed.body.ok,true);assert.equal('data' in changed.body,false)
 assert.equal(f.run('POST','/users',{empresa_id:'1',username:'operador-qa',nombre:'Repetido',password}).status,409)
 assert.equal(JSON.stringify(f.state.summary()).includes(password),false)
 assert.throws(()=>parseUser({...result.body.data,bloqueado:'false'}))
})
test('administración: roles y permisos asignan/retiran con contexto; rol asignado no se elimina',()=>{
 const f=fixture(),role=parseRole(f.run('POST','/roles',{codigo:'CAJERO-QA',nombre:'Cajero QA',descripcion:null,activo:true}).body.data),user=f.run('POST','/users',{empresa_id:'1',username:'caja-qa',nombre:'Caja QA',password:'SoloFixture-2026'}).body.data
 const permission=parsePermission(f.run('GET','/permissions').body.data[0])
 assert.equal(f.run('POST',`/roles/${role.id}/permissions/${permission.id}`).body.data.rol_id,role.id)
 assert.equal(f.run('POST',`/users/${user.id}/roles/${role.id}`).body.data.usuario_id,user.id)
 assert.equal(f.run('DELETE','/roles/'+role.id).status,409)
 assert.equal(f.run('GET',`/users/${user.id}/roles`).body.data[0].id,role.id)
 assert.equal(f.run('DELETE',`/users/${user.id}/roles/${role.id}`).status,200)
 assert.equal(f.run('DELETE',`/roles/${role.id}/permissions/${permission.id}`).status,200)
 assert.equal(f.run('DELETE','/roles/'+role.id).body.data.id,role.id)
})
test('validación administrativa: contraseñas UTF-8, campos y respuestas duplicadas',()=>{
 assert.equal(validatePassword('SoloFixture-2026','SoloFixture-2026'),'SoloFixture-2026')
 for(const pair of [['corta','corta'],['distintos-1','distintos-2'],['😀'.repeat(20),'😀'.repeat(20)]])assert.throws(()=>validatePassword(...pair))
 assert.throws(()=>userInput({username:'ab',nombre:'QA',apellido:'',email:'',telefono:'',activo:true},'1',false))
 assert.throws(()=>userInput({username:'abc',nombre:'QA',apellido:'',email:'correo-invalido',telefono:'',activo:true},'1',false))
 assert.equal(roleInput({codigo:' QA ',nombre:' Caja ',descripcion:'',activo:true}).codigo,'QA')
 assert.equal(userInput({username:'operador',nombre:'QA',apellido:'',email:'QA@EXAMPLE.TEST',telefono:'',activo:true},'1',false).email,'qa@example.test')
 const f=fixture(),role=f.run('GET','/roles').body.data[0];assert.throws(()=>parseArray([role,role],parseRole))
})
test('crédito documental: importe neto no es cartera; devoluciones y cancelación reducen el crédito',()=>{
 const f=fixture(),body={empresa_id:'1',sucursal_id:'2',almacen_id:'1',cliente_id:'8',sesion_caja_id:null,folio:'CRED-QA',detalles:[{producto_id:product,cantidad:'1',descuento_porcentaje:'0'}],pagos:[{metodo_pago_id:'3',monto:'116.00',referencia:null}]},sale=f.run('POST','/sales',body).body.data
 const get=()=>f.run('GET','/sales/'+sale.id+'/financial-summary').body.data
 assert.equal(creditSummary(get(),sale.id).net,'116.00')
 assert.throws(()=>creditSummary({...get(),credito:{...get().credito,cuentas_por_cobrar_integrado:true}},sale.id))
 assert.equal(f.run('GET','/sales?condicion_pago=CREDITO&cliente_id=9').body.data.length,0)
 assert.equal(f.run('PATCH','/sales/'+sale.id+'/cancel',{}).status,200);assert.equal(creditSummary(get(),sale.id).net,'0.00')
})
test('módulos nuevos: menú conserva accesos previos; permisos bloquean escrituras en ambos escenarios limitados',()=>{
 const paths=getVisibleNavigationSections(commercialUser().permisos.map(row=>row.codigo)).flatMap(section=>section.items.map(row=>row.to))
 for(const path of ['/pos','/sales','/customers','/inventory','/purchases','/quotes','/sales-orders','/customer-orders','/credits','/users','/roles','/permissions'])assert.ok(paths.includes(path),path)
 for(const scenario of ['read-only','no-permission']){const f=fixture(scenario);for(const path of ['/quotes','/customer-orders','/sales-orders','/users','/roles'])assert.equal(f.run('POST',path,input()).status,403)}
 assert.equal(fixture('no-permission').run('GET','/users').status,403)
})
test('HTTP aislado: documentos y catálogos administrativos responden desde el simulador conjunto',async()=>{
 const fixture=await startCommercialFixture(0)
 try{
  const headers={Authorization:'Bearer fixture-normal','Content-Type':'application/json'},response=await fetch(fixture.url+'/api/v1/quotes',{method:'POST',headers,body:JSON.stringify(input())});assert.equal(response.status,201)
  const created=await response.json();assert.equal(parseDocument(created.data,'quotes','1').total,'232.00')
  for(const path of ['/api/v1/roles','/api/v1/permissions','/api/v1/users?page=1&limit=20'])assert.equal((await fetch(fixture.url+path,{headers})).status,200)
  const changed=await fetch(fixture.url+'/api/v1/users/3/password',{method:'PATCH',headers,body:JSON.stringify({password:'SoloFixture-2026'})});assert.equal(changed.status,200);assert.deepEqual(await changed.json(),{ok:true,message:'Contraseña actualizada correctamente.'})
  const denied=await fetch(fixture.url+'/api/v1/quotes',{method:'POST',headers:{...headers,Authorization:'Bearer fixture-read-only'},body:JSON.stringify(input())});assert.equal(denied.status,403)
 }finally{await fixture.server.close()}
})
