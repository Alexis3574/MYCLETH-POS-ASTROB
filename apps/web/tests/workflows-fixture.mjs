// Oráculo independiente y exclusivamente en memoria. No importa la API, Prisma,
// .env ni validadores frontend; nunca conserva contraseñas en su estado/log.
export const workflowViewCodes=['COTIZACIONES.VER','ORDENES.VER','PEDIDOS.VER','USUARIOS.VER']
export const workflowWriteCodes=['COTIZACIONES.CREAR','ORDENES.CREAR','PEDIDOS.CREAR','USUARIOS.GESTIONAR']
const codes=[...workflowViewCodes,...workflowWriteCodes,'VENTAS.VER','VENTAS.CREAR','INVENTARIO.VER','CLIENTES.VER']
export const workflowPermissionCatalog=codes.map((codigo,index)=>({id:String(800+index),codigo,modulo:codigo.split('.')[0],descripcion:'Permiso de prueba '+codigo}))
const now=()=>new Date().toISOString(),ok=(data,status=200)=>({status,body:{ok:true,data:structuredClone(data)}}),fail=(status,message)=>({status,body:{ok:false,message}})
function number(value,scale){const match=/^(\d+)(?:\.(\d+))?$/.exec(String(value));if(!match||(match[2]||'').length>scale)throw Error('Decimal inválido.');return BigInt(match[1])*10n**BigInt(scale)+BigInt((match[2]||'').padEnd(scale,'0'))}
const dec=(value,scale=2)=>value/10n**BigInt(scale)+'.'+String(value%10n**BigInt(scale)).padStart(scale,'0'),round=(value,divisor)=>(value+divisor/2n)/divisor
const defs={quotes:{field:'cotizacion_detalle',date:'valida_hasta',initial:'BORRADOR',states:{BORRADOR:{send:'ENVIADA',cancel:'CANCELADA'},ENVIADA:{accept:'ACEPTADA',reject:'RECHAZADA',expire:'VENCIDA',cancel:'CANCELADA'}}},'sales-orders':{field:'orden_venta_detalle',date:'fecha_compromiso',initial:'PENDIENTE',states:{PENDIENTE:{start:'EN_PROCESO',cancel:'CANCELADA'},EN_PROCESO:{ready:'LISTA',cancel:'CANCELADA'},LISTA:{cancel:'CANCELADA'}}},'customer-orders':{field:'pedido_cliente_detalle',date:'fecha_entrega',initial:'PENDIENTE',states:{PENDIENTE:{confirm:'CONFIRMADO',cancel:'CANCELADO'},CONFIRMADO:{prepare:'EN_PREPARACION',cancel:'CANCELADO'},EN_PREPARACION:{ready:'LISTO',cancel:'CANCELADO'},LISTO:{deliver:'ENTREGADO',cancel:'CANCELADO'}}}}
const branch=id=>({id,codigo:'S-'+(Number(id)-1),nombre:'Sucursal '+(Number(id)-1)})
const client={id:'8',codigo:'C-001',nombre:'Cliente de prueba'}
export function createWorkflowFixture(baseForScenario){
 const scenarios=new Map();let nextDoc=9007199254747000n,nextUser=100n,nextRole=10n
 function stateFor(scenario){
  if(!scenarios.has(scenario)){
   const user={id:'3',empresa_id:'1',username:'prueba',nombre:'Operador de prueba',apellido:null,email:null,telefono:null,activo:true,bloqueado:false,ultimo_acceso:null}
   scenarios.set(scenario,{docs:{quotes:[],'sales-orders':[],'customer-orders':[]},links:new Map(),users:[user],roles:[{id:'1',codigo:'ADMIN-QA',nombre:'Administrador simulado',descripcion:'Rol de la sesión de prueba',activo:true}],userRoles:new Map([['3',new Set(['1'])]]),rolePermissions:new Map([['1',new Set(workflowPermissionCatalog.map(row=>row.id))]]),operations:0})
  }
  return scenarios.get(scenario)
 }
 function details(input,id,kind){
  if(!Array.isArray(input)||!input.length||input.length>100||new Set(input.map(row=>row.producto_id)).size!==input.length)throw Error('Partidas requeridas sin duplicados.')
  return input.map((line,index)=>{
   if(!['9007199254740993','40'].includes(line.producto_id))throw Error('Producto no disponible.')
   const quantity=number(line.cantidad,3),percentage=number(line.descuento_porcentaje??'0',4),service=line.producto_id==='40',price=service?500000n:1000000n,tax=service?0n:160000n
   if(quantity<=0n||!service&&quantity%1000n||percentage>1000000n)throw Error('Cantidad o descuento inválido.')
   const subtotal=round(quantity*price,100000n),discount=round(subtotal*percentage,1000000n),taxes=round((subtotal-discount)*tax,1000000n)
   return{id:String(index+1),[kind==='quotes'?'cotizacion_id':kind==='sales-orders'?'orden_venta_id':'pedido_cliente_id']:id,producto_id:line.producto_id,descripcion:line.descripcion??(service?'Servicio por hora':'Artículo de prueba'),cantidad:dec(quantity,3),precio_unitario:dec(price,4),descuento_porcentaje:dec(percentage,4),tasa_impuesto:dec(tax,4),subtotal_linea:dec(subtotal),descuento_importe:dec(discount),impuesto_importe:dec(taxes),total_linea:dec(subtotal-discount+taxes),producto:{id:line.producto_id,sku:service?'SERV-001':'P-001',nombre:service?'Servicio por hora':'Artículo de prueba'}}
  })
 }
 function build(kind,input,id){
  if(!['2','3'].includes(input.sucursal_id)||input.cliente_id!=null&&input.cliente_id!=='8'||kind==='customer-orders'&&!input.cliente_id||typeof input.folio!=='string'||!input.folio.trim()||input.folio.length>50||!/^[\p{L}\p{N}_./-]+$/u.test(input.folio))throw Error('Contexto o folio inválido.')
  const config=defs[kind],lines=details(input.detalles,id,kind),sums={}
  for(const[key,lineKey]of[['subtotal','subtotal_linea'],['descuento','descuento_importe'],['impuesto','impuesto_importe'],['total','total_linea']])sums[key]=dec(lines.reduce((sum,row)=>sum+number(row[lineKey],2),0n))
  return{id,empresa_id:'1',usuario_id:'3',sucursal_id:input.sucursal_id,cliente_id:input.cliente_id??null,folio:input.folio.trim(),fecha:now(),estado:config.initial,observaciones:input.observaciones??null,[config.date]:input[config.date]?input[config.date]+'T00:00:00.000Z':null,...(kind==='sales-orders'?{cotizacion_id:null}:{}),...(kind==='customer-orders'?{referencia_cliente:input.referencia_cliente??null}:{}),sucursal:branch(input.sucursal_id),cliente:input.cliente_id?client:null,...sums,[config.field]:lines}
 }
 function roles(state){return state.roles.map(row=>({...row,creado_en:now(),usuarios_asignados:[...state.userRoles.values()].filter(set=>set.has(row.id)).length,permisos_asignados:state.rolePermissions.get(row.id)?.size??0}))}
 function mutate(state,scenario,data,status=200){state.operations++;return scenario==='workflow-fault'?fail(503,'Respuesta perdida tras registrar la operación ficticia.'):ok(data,status)}
 function handle(method,url,scenario='normal',input=null){
  const path=url.pathname.replace(/^\/api\/v1/,''),kind=path.split('/')[1]
  if(!defs[kind]&&!/^\/(users|roles|permissions)(\/|$)/.test(path))return null
  if(scenario==='no-permission'||scenario==='read-only'&&method!=='GET')return fail(403,'Sin permiso para esta operación.')
  const state=stateFor(scenario)
  try{
   if(defs[kind]){
    const config=defs[kind],match=new RegExp('^/'+kind+'/(\\d+)(?:/([a-z-]+))?$').exec(path),row=match&&state.docs[kind].find(doc=>doc.id===match[1]),action=match?.[2]
    if(method==='GET'){
     if(path==='/'+kind){const page=Number(url.searchParams.get('page')||1),pageSize=Number(url.searchParams.get('pageSize')||20),q=(url.searchParams.get('q')||'').toLowerCase(),status=url.searchParams.get('estado'),rows=[...state.docs[kind]].reverse().filter(doc=>(!status||doc.estado===status)&&doc.folio.toLowerCase().includes(q));return ok({rows:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,page,pageSize})}
     return row?ok(row):fail(404,'Documento no encontrado.')
    }
    if(method==='POST'&&path==='/'+kind){if(state.docs[kind].some(doc=>doc.folio===input?.folio))return fail(409,'Folio existente.');const created=build(kind,input,String(nextDoc++));state.docs[kind].push(created);return mutate(state,scenario,created,201)}
    if(!row)return fail(404,'Documento no encontrado.')
    if(method==='PATCH'&&!action){
     if(row.estado!==config.initial)return fail(409,'Estado no editable.')
     if(kind==='sales-orders'&&row.cotizacion_id&&(input.detalles!==undefined||input.cliente_id!==undefined))return fail(409,'La orden conserva cliente y partidas de cotización.')
     const next=build(kind,{...row,...input,detalles:input.detalles??row[config.field],[config.date]:input[config.date]===undefined?row[config.date]?.slice(0,10):input[config.date]},row.id)
     Object.assign(next,{fecha:row.fecha,estado:row.estado,...(kind==='sales-orders'?{cotizacion_id:row.cotizacion_id}:{})});Object.assign(row,next);return mutate(state,scenario,row)
    }
    if(method!=='POST')return fail(405,'Método no admitido.')
    if(kind==='quotes'&&action==='convert-to-order'){
     const existing=state.docs['sales-orders'].find(doc=>doc.cotizacion_id===row.id)
     if(existing)return existing.folio===input.folio?ok(existing,201):fail(409,'La cotización ya fue convertida.')
     if(row.estado!=='ACEPTADA')return fail(409,'Se requiere cotización aceptada.')
     if(row.valida_hasta&&row.valida_hasta.slice(0,10)<now().slice(0,10))return fail(409,'Cotización vencida.')
     if(state.docs['sales-orders'].some(doc=>doc.folio===input.folio))return fail(409,'Folio de orden existente.')
     const order=build('sales-orders',{...row,...input,detalles:row[config.field]},String(nextDoc++));order.cotizacion_id=row.id;state.docs['sales-orders'].push(order);row.estado='CONVERTIDA';return mutate(state,scenario,order,201)
    }
    if(action==='convert-to-sale'&&kind!=='quotes'){
     const key=kind+':'+row.id;if(row.estado!==(kind==='sales-orders'?'LISTA':'LISTO')||state.links.has(key))return fail(409,'Documento no listo o con venta asociada.')
     if(!input?.folio||input.folio.length>50||!['1','2'].includes(input.almacen_id)||String(Number(input.almacen_id)+1)!==row.sucursal_id)return fail(422,'Folio o almacén inválido.')
     const saleInput={empresa_id:'1',sucursal_id:row.sucursal_id,almacen_id:input.almacen_id,cliente_id:row.cliente_id,sesion_caja_id:input.sesion_caja_id??null,folio:input.folio,observaciones:input.observaciones??row.observaciones,detalles:row[config.field].map(line=>({producto_id:line.producto_id,cantidad:line.cantidad,descuento_porcentaje:line.descuento_porcentaje})),pagos:input.pagos}
     const response=baseForScenario(scenario).handle('POST',new URL('/api/v1/sales',url),scenario,saleInput)
     if(response.status!==201)return response
     const sale=response.body.data,field=kind==='sales-orders'?'orden_venta_id':'pedido_cliente_id';sale[field]=row.id;state.links.set(key,sale.id)
     return mutate(state,scenario,{...sale,[field]:row.id},201)
    }
    const target=config.states[row.estado]?.[action]
    if(!target||action==='cancel'&&state.links.has(kind+':'+row.id))return fail(409,'Transición no permitida.')
    if(kind==='quotes'&&action==='expire'&&(!row.valida_hasta||row.valida_hasta.slice(0,10)>=now().slice(0,10)))return fail(409,'Cotización todavía vigente.')
    if(kind==='quotes'&&['send','accept'].includes(action)&&row.valida_hasta&&row.valida_hasta.slice(0,10)<now().slice(0,10))return fail(409,'Cotización vencida.')
    row.estado=target;return mutate(state,scenario,row)
   }
   if(path==='/permissions'&&method==='GET')return ok(workflowPermissionCatalog)
   if(path==='/users/count'&&method==='GET')return ok({total:state.users.length})
   if(path==='/users'){
    if(method==='GET'){const page=Number(url.searchParams.get('page')||1),limit=Number(url.searchParams.get('limit')||20);return{status:200,body:{ok:true,data:structuredClone(state.users.slice((page-1)*limit,page*limit)),pagination:{page,limit,total:state.users.length,totalPages:Math.ceil(state.users.length/limit)}}}}
    if(method==='POST'){
     if(input.empresa_id!=='1'||!input.username?.trim()||input.username.length<3||!input.nombre?.trim()||typeof input.password!=='string'||input.password.length<8||Buffer.byteLength(input.password)>72)return fail(400,'Datos de usuario inválidos.')
     if(state.users.some(row=>row.username===input.username))return fail(409,'Usuario duplicado.')
     const user={id:String(nextUser++),empresa_id:'1',username:input.username,nombre:input.nombre,apellido:input.apellido??null,email:input.email??null,telefono:input.telefono??null,activo:input.activo??true,bloqueado:false,ultimo_acceso:null};state.users.push(user);return mutate(state,scenario,user,201)
    }
   }
   const userMatch=/^\/users\/(\d+)(?:\/(password|roles)(?:\/(\d+))?)?$/.exec(path)
   if(userMatch){
    const user=state.users.find(row=>row.id===userMatch[1]);if(!user)return fail(404,'Usuario no encontrado.')
    if(userMatch[2]==='roles'){
     const assignments=state.userRoles.get(user.id)??new Set(),role=state.roles.find(row=>row.id===userMatch[3])
     if(method==='GET')return ok(roles(state).filter(row=>assignments.has(row.id)))
     if(!role)return fail(404,'Rol no encontrado.')
     if(method==='POST'){if(!role.activo||assignments.has(role.id))return fail(409,'Rol inactivo o asignado.');assignments.add(role.id);state.userRoles.set(user.id,assignments);return mutate(state,scenario,{usuario_id:user.id,rol:role},201)}
     if(method==='DELETE'){if(!assignments.has(role.id))return fail(404,'Rol no asignado.');assignments.delete(role.id);return mutate(state,scenario,{usuario_id:user.id,rol_id:role.id})}
    }
    if(userMatch[2]==='password'&&method==='PATCH'){if(typeof input.password!=='string'||input.password.length<8||Buffer.byteLength(input.password)>72)return fail(400,'Contraseña inválida.');const response=mutate(state,scenario,null);return response.status===503?response:{status:200,body:{ok:true,message:'Contraseña actualizada correctamente.'}}}
    if(!userMatch[2]&&method==='GET')return ok(user)
    if(!userMatch[2]&&method==='PATCH'){const next={...user,...input};if(!next.username?.trim()||next.username.length<3||!next.nombre?.trim())return fail(400,'Perfil inválido.');if(state.users.some(row=>row.id!==user.id&&row.username===next.username))return fail(409,'Usuario duplicado.');for(const key of ['username','nombre','apellido','email','telefono','activo'])if(input[key]!==undefined)user[key]=input[key];return mutate(state,scenario,user)}
   }
   if(path==='/roles'){
    if(method==='GET')return ok(roles(state))
    if(method==='POST'){if(!input.codigo?.trim()||input.codigo.length>60||!input.nombre?.trim()||input.nombre.length>100)return fail(400,'Datos de rol inválidos.');if(state.roles.some(row=>row.codigo===input.codigo))return fail(409,'Código de rol duplicado.');const role={id:String(nextRole++),codigo:input.codigo,nombre:input.nombre,descripcion:input.descripcion??null,activo:input.activo??true};state.roles.push(role);return mutate(state,scenario,role,201)}
   }
   const roleMatch=/^\/roles\/(\d+)(?:\/permissions(?:\/(\d+))?)?$/.exec(path)
   if(roleMatch){
    const role=state.roles.find(row=>row.id===roleMatch[1]);if(!role)return fail(404,'Rol no encontrado.')
    if(path.includes('/permissions')){
     const assignments=state.rolePermissions.get(role.id)??new Set(),permission=workflowPermissionCatalog.find(row=>row.id===roleMatch[2])
     if(method==='GET')return ok({rol:role,permisos:workflowPermissionCatalog.filter(row=>assignments.has(row.id))})
     if(!permission)return fail(404,'Permiso no encontrado.')
     if(method==='POST'){if(!role.activo||assignments.has(permission.id))return fail(409,'Rol inactivo o permiso asignado.');assignments.add(permission.id);state.rolePermissions.set(role.id,assignments);return mutate(state,scenario,{rol_id:role.id,permiso:permission},201)}
     if(method==='DELETE'){if(!assignments.has(permission.id))return fail(404,'Permiso no asignado.');assignments.delete(permission.id);return mutate(state,scenario,{rol_id:role.id,permiso_id:permission.id})}
    }
    if(method==='GET')return ok(roles(state).find(row=>row.id===role.id))
    if(method==='PATCH'){if(input.codigo&&state.roles.some(row=>row.id!==role.id&&row.codigo===input.codigo))return fail(409,'Código duplicado.');for(const key of ['codigo','nombre','descripcion','activo'])if(input[key]!==undefined)role[key]=input[key];return mutate(state,scenario,role)}
    if(method==='DELETE'){if([...state.userRoles.values()].some(set=>set.has(role.id))||state.rolePermissions.get(role.id)?.size)return fail(409,'Rol con asignaciones.');state.roles=state.roles.filter(row=>row.id!==role.id);return mutate(state,scenario,{id:role.id})}
   }
   return fail(405,'Operación fuera del contrato simulado.')
  }catch{return fail(400,'Datos inválidos para el contrato simulado.')}
 }
 return{handle,summary:()=>({scenarios:[...scenarios].map(([name,state])=>({name,documents:Object.fromEntries(Object.entries(state.docs).map(([kind,rows])=>[kind,rows.length])),users:state.users.length,roles:state.roles.length,operations:state.operations,linkedSales:state.links.size}))})}
}
