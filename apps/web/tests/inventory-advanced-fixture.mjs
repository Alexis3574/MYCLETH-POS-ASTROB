// Oráculo en memoria: no usa Prisma, la API real, .env ni cálculos frontend.
const ok=(data,status=200)=>({status,body:{ok:true,data:structuredClone(data)}})
const fail=(status,message,code='INVENTORY_FIXTURE_ERROR')=>({status,body:{ok:false,message,code}})
const now=()=>new Date().toISOString()
const qty=value=>{
  const match=/^(\d+)(?:\.(\d{1,3}))?$/.exec(String(value));if(!match)throw new Error('Cantidad inválida')
  return BigInt(match[1])*1000n+BigInt((match[2]||'').padEnd(3,'0'))
}
function cost(value){const match=/^(\d+)(?:\.(\d{1,4}))?$/.exec(String(value));if(!match)throw new Error('Costo inválido');return BigInt(match[1])*10000n+BigInt((match[2]||'').padEnd(4,'0'))}
const text=(units,scale=3)=>{const abs=units<0n?-units:units;return(units<0n?'-':'')+abs/10n**BigInt(scale)+'.'+String(abs%10n**BigInt(scale)).padStart(scale,'0')}
const incoming=type=>['ENTRADA','AJUSTE_POSITIVO','TRANSFERENCIA_ENTRADA'].includes(type)
const delta=row=>qty(row.cantidad)*(incoming(row.tipo)?1n:-1n)
export const inventoryWarehouse=id=>({id:String(id),codigo:'A-'+id,nombre:'Almacén '+id,activo:true,sucursal:{id:String(Number(id)+1),empresa_id:'1',codigo:'S-'+id,nombre:'Sucursal '+id,activo:true}})
export const inventoryProduct={id:'9007199254740993',sku:'P-001',codigo_barras:'750001',nombre:'Artículo de prueba',activo:true}
const unit={id:'1',codigo:'PZA',nombre:'Pieza',permite_decimales:false}
const products=[{...inventoryProduct,unidad:unit,min:'5.000',max:'12.000'},{id:'42',sku:'FRAC-001',codigo_barras:null,nombre:'Insumo fraccionable',activo:true,unidad:{id:'2',codigo:'M',nombre:'Metro',permite_decimales:true},min:'0.500',max:'5.000'},{id:'43',sku:'SIN-001',codigo_barras:'750043',nombre:'Producto sin existencia',activo:true,unidad:unit,min:'1.000',max:null}]
export function createInventoryFixture(){
  const scenarios=new Map(),requests=[];let nextMovement=9007199254744000n,nextAdjustment=9007199254745000n,nextTransfer=9007199254746000n,nextOperation=1n
  function scenarioState(scenario){
    if(!scenarios.has(scenario)){
      const catalog=scenario==='paged-alerts'||scenario==='changing-alerts'?Array.from({length:102},(_,i)=>({...products[0],id:String(100+i),sku:'PAGE-'+i,nombre:'Artículo '+String(i).padStart(3,'0'),min:i===101?'2.000':'0.000',max:null})):structuredClone(products)
      const stocks=new Map()
      for(const warehouse of ['1','2'])for(const product of catalog){const primary=product.id===inventoryProduct.id,frac=product.id==='42',empty=product.id==='43'||catalog.length>100&&product.sku==='PAGE-101';stocks.set(warehouse+':'+product.id,{cantidad:empty?'0.000':frac?'1.250':primary&&warehouse==='2'?'4.000':'10.000',reservado:frac?'0.250':primary?warehouse==='1'?'2.000':'1.000':'0.000',disponible:empty?'0.000':frac?'1.000':primary?warehouse==='1'?'8.000':'3.000':'10.000',costo_promedio:warehouse==='2'?'50.0000':'100.0000',registered:!empty})}
      const state={catalog,stocks,movements:[],transfers:[],operations:new Map(),sync:0}
      if(catalog.length<100)state.movements.push({id:String(nextMovement++),productId:inventoryProduct.id,warehouseId:'1',tipo:'ENTRADA',cantidad:'3.000',costo_unitario:'100.0000',documento_tipo:'COMPRA',documento_id:'1',documento_detalle_id:'1',usuario_id:'3',motivo:'Movimiento histórico de prueba',fecha:'2026-11-22T12:00:00.000Z',sync:null})
      scenarios.set(scenario,state)
    }
    return scenarios.get(scenario)
  }
  function stockState(row){return{cantidad:row.cantidad,reservado:row.reservado,disponible:row.disponible,costo_promedio:row.costo_promedio}}
  function rowStock(state,warehouse,product){const row=state.stocks.get(warehouse+':'+product.id);return{producto:{id:product.id,sku:product.sku,codigo_barras:product.codigo_barras,nombre:product.nombre,activo:product.activo},almacen_id:warehouse,...stockState(row),existencia_registrada:row.registered,stock_minimo:product.min,stock_maximo:product.max,bajo_minimo:qty(row.disponible)<qty(product.min),unidad:product.unidad,actualizado_en:row.registered?'2026-11-22T12:00:00.000Z':null}}
  function page(rows,url){const page=Number(url.searchParams.get('page')||1),limit=Number(url.searchParams.get('limit')||20);return{ok:true,data:structuredClone(rows.slice((page-1)*limit,page*limit)),pagination:{page,limit,total:rows.length,total_pages:Math.ceil(rows.length/limit)}}}
  function serializeMovement(state,row){return{id:row.id,producto:{...state.catalog.find(product=>product.id===row.productId)},almacen:{id:row.warehouseId,codigo:'A-'+row.warehouseId,nombre:'Almacén '+row.warehouseId,sucursal_id:String(Number(row.warehouseId)+1)},usuario_id:row.usuario_id,tipo:row.tipo,cantidad:row.cantidad,costo_unitario:row.costo_unitario,documento_tipo:row.documento_tipo,documento_id:row.documento_id,documento_detalle_id:row.documento_detalle_id,motivo:row.motivo,fecha:row.fecha,creado_en:row.fecha,sincronizacion:row.sync}}
  function transferMovement(row){return{id:row.id,producto_id:row.productId,almacen_id:row.warehouseId,tipo:row.tipo,cantidad:row.cantidad,costo_unitario:row.costo_unitario,documento_detalle_id:row.documento_detalle_id,fecha:row.fecha}}
  function applyStock(row,quantity,sourceCost=null){const before=qty(row.cantidad),after=before+quantity;if(after<qty(row.reservado)||after>99999999999999n)throw new Error('Existencia insuficiente o límite excedido');if(quantity>0n&&sourceCost!==null){const denominator=before+quantity;row.costo_promedio=text((2n*(before*cost(row.costo_promedio)+quantity*cost(sourceCost))+denominator)/(2n*denominator),4)}row.cantidad=text(after);row.disponible=text(after-qty(row.reservado));row.registered=true}
  function handle(method,url,scenario='normal',input=null,key=null){
    const path=url.pathname.replace(/^\/api\/v1/,'')
    if(!path.startsWith('/inventory')&&!path.startsWith('/transfers'))return null
    requests.push({method,path,scenario,key})
    if(scenario==='no-permission'||method!=='GET'&&scenario==='read-only')return fail(403,'Sin permiso de inventario.')
    const state=scenarioState(scenario),warehouse=url.searchParams.get('almacen_id')||'1',productId=url.searchParams.get('producto_id')||''
    if(method==='GET'&&path==='/inventory/warehouses'){return{status:200,body:page((scenario==='limited'?['1']:['1','2']).map(inventoryWarehouse),url)}}
    if(method==='GET'&&path==='/inventory/stock'){
      if(!['1','2'].includes(warehouse)||scenario==='limited'&&warehouse==='2')return fail(404,'Almacén no disponible.')
      const search=(url.searchParams.get('search')||'').toLowerCase(),rows=state.catalog.filter(row=>(!productId||row.id===productId)&&[row.nombre,row.sku,row.codigo_barras].some(value=>String(value||'').toLowerCase().includes(search))).map(row=>rowStock(state,warehouse,row))
      const body={...page(rows,url),almacen:{id:warehouse,codigo:'A-'+warehouse,nombre:'Almacén '+warehouse,activo:true}}
      if(scenario==='malformed-stock'&&body.data.length)body.data[0].disponible='999.000'
      if(scenario==='changing-alerts'&&Number(url.searchParams.get('page'))>1)body.pagination.total+=1
      return{status:200,body}
    }
    if(method==='GET'&&(path==='/inventory/movements'||path==='/inventory/kardex')){
      if(scenario==='limited'&&warehouse==='2')return fail(404,'Almacén no disponible.')
      const from=url.searchParams.get('fecha_desde'),to=url.searchParams.get('fecha_hasta'),type=url.searchParams.get('tipo')
      const all=state.movements.filter(row=>row.warehouseId===warehouse&&(!productId||row.productId===productId)).sort((a,b)=>a.fecha.localeCompare(b.fecha)||(BigInt(a.id)<BigInt(b.id)?-1:1)),period=all.filter(row=>(!from||row.fecha>=from)&&(!to||row.fecha<=to)&&(!type||row.tipo===type))
      if(path==='/inventory/movements')return{status:200,body:page([...period].reverse().map(row=>serializeMovement(state,row)),url)}
      const product=state.catalog.find(row=>row.id===productId),stock=state.stocks.get(warehouse+':'+productId);if(!product||!stock)return fail(404,'Producto no encontrado.')
      const base=qty(stock.cantidad)-all.reduce((sum,row)=>sum+delta(row),0n),initial=base+all.filter(row=>from&&row.fecha<from).reduce((sum,row)=>sum+delta(row),0n),entries=period.filter(row=>incoming(row.tipo)).reduce((sum,row)=>sum+qty(row.cantidad),0n),exits=period.filter(row=>!incoming(row.tipo)).reduce((sum,row)=>sum+qty(row.cantidad),0n)
      let balance=base;const rows=all.map(row=>{const before=balance;balance+=delta(row);const{producto,almacen,sincronizacion,creado_en,...rest}=serializeMovement(state,row);void producto;void almacen;void sincronizacion;void creado_en;return{...rest,delta:text(delta(row)),saldo_antes:text(before),saldo_despues:text(balance)}}).filter(row=>(!from||row.fecha>=from)&&(!to||row.fecha<=to))
      const body={...page(rows,url),producto:{id:product.id,nombre:product.nombre,sku:product.sku},almacen:{id:warehouse,nombre:'Almacén '+warehouse,codigo:'A-'+warehouse},periodo:{fecha_desde:from,fecha_hasta:to},resumen:{metodo_saldo:'RECONSTRUIDO_DESDE_EXISTENCIA_ACTUAL',saldo_base_reconstruido:text(base),saldo_inicial_periodo:text(initial),entradas_periodo:text(entries),salidas_periodo:text(exits),saldo_final_periodo:text(initial+entries-exits)},existencia_actual:{...stockState(stock),existencia_registrada:stock.registered}}
      if(scenario==='malformed-kardex')body.resumen.saldo_final_periodo='999.000'
      return{status:200,body}
    }
    if(method==='GET'&&path==='/transfers'){
      const search=(url.searchParams.get('search')||'').toLowerCase(),status=url.searchParams.get('estado')
      return{status:200,body:page([...state.transfers].reverse().filter(row=>(row.almacen_origen.id===warehouse||row.almacen_destino.id===warehouse)&&(!status||row.estado===status)&&row.folio.toLowerCase().includes(search)).map(({detalles,...row})=>{void detalles;return row}),url)}
    }
    const match=/^\/transfers\/(\d+)(?:\/(complete|cancel))?$/.exec(path),transfer=match&&state.transfers.find(row=>row.id===match[1])
    if(method==='GET'&&match){if(!transfer)return fail(404,'Traspaso no encontrado.');const operations=[...state.operations.values()].filter(op=>op.transferId===transfer.id).map(op=>({id:op.id,usuario_id:'3',accion:op.response.data.operacion.accion,fecha:op.response.data.operacion.fecha}));const result={...transfer,movimientos:state.movements.filter(row=>row.documento_tipo==='TRANSFERENCIA_ALMACEN'&&row.documento_id===transfer.id).map(transferMovement),operaciones:operations,ecommerce:{eventos_creados_por_este_modulo:0,politica:'SIN_EVENTOS_ALMACENES_PENDIENTES'}};if(scenario==='malformed-transfer')result.movimientos=null;return ok(result)}
    if(method!=='POST'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key||''))return fail(400,'Idempotency-Key obligatorio.')
    const hash=JSON.stringify({path,input}),previous=state.operations.get(key)
    if(previous)return previous.hash===hash?{status:200,body:{...structuredClone(previous.response),replayed:true}}:fail(409,'Clave reutilizada con otro contenido.','IDEMPOTENCY_CONFLICT')
    try{
      let result,kind,transferId=null
      if(path==='/inventory/adjustments'){
        const product=state.catalog.find(row=>row.id===input?.producto_id),stock=state.stocks.get(input?.almacen_id+':'+input?.producto_id),quantity=qty(input?.cantidad)
        if(!product||!stock||scenario==='limited'&&input.almacen_id==='2')return fail(404,'Contexto no disponible.')
        if(!['AJUSTE_POSITIVO','AJUSTE_NEGATIVO'].includes(input.tipo)||quantity<=0n||!product.unidad.permite_decimales&&quantity%1000n||typeof input.motivo!=='string'||!input.motivo.trim()||input.motivo.length>1000||input.tipo==='AJUSTE_NEGATIVO'&&input.costo_unitario!==null)return fail(400,'Ajuste inválido.')
        if(input.sincronizar_ecommerce&&(!product.codigo_barras||quantity%1000n||quantity>2147483647000n))return fail(400,'Sincronización no válida.')
        const before=stockState(stock),copy={...stock};applyStock(copy,input.tipo==='AJUSTE_POSITIVO'?quantity:-quantity,input.costo_unitario)
        const adjustmentId=String(nextAdjustment++),movementId=String(nextMovement++),date=now(),sync=input.sincronizar_ecommerce?{id:String(++state.sync),operation_id:'inventory-adjustment:company:1:id:'+adjustmentId+':stock',adjustment:Number(quantity/1000n)*(input.tipo==='AJUSTE_POSITIVO'?1:-1),estado:'PENDIENTE',intentos:0,sincronizado_en:null}:null
        Object.assign(stock,copy);state.movements.push({id:movementId,productId:product.id,warehouseId:input.almacen_id,tipo:input.tipo,cantidad:text(quantity),costo_unitario:input.costo_unitario,documento_tipo:'AJUSTE_INVENTARIO',documento_id:adjustmentId,documento_detalle_id:adjustmentId,usuario_id:'3',motivo:input.motivo,fecha:date,sync})
        result={ajuste_id:adjustmentId,empresa_id:'1',almacen_id:input.almacen_id,producto_id:input.producto_id,usuario_id:'3',clave_idempotencia:key,tipo:input.tipo,cantidad:input.cantidad,costo_unitario:input.costo_unitario,motivo:input.motivo,fecha:date,movimiento_id:movementId,existencia_antes:before,existencia_despues:stockState(stock),sincronizacion:{solicitada:input.sincronizar_ecommerce,evento_id:sync?.id??null,operation_id:sync?.operation_id??null,estado_al_crear:sync?.estado??null}};kind='adjust'
      }else{
        let record=transfer,action,changes=[]
        if(path==='/transfers'){
          if(!['1','2'].includes(input?.almacen_origen_id)||!['1','2'].includes(input.almacen_destino_id)||input.almacen_origen_id===input.almacen_destino_id||scenario==='limited')return fail(404,'Almacenes no disponibles.')
          if(!Array.isArray(input.detalles)||!input.detalles.length||input.detalles.length>100||new Set(input.detalles.map(row=>row.producto_id)).size!==input.detalles.length)return fail(400,'Detalles inválidos.')
          const id=String(nextTransfer++),details=[]
          for(const[lineIndex,line]of input.detalles.entries()){const product=state.catalog.find(row=>row.id===line.producto_id),quantity=qty(line.cantidad);if(!product||quantity<=0n||!product.unidad.permite_decimales&&quantity%1000n)return fail(400,'Producto o cantidad inválidos.');details.push({id:String(lineIndex+1),producto_id:product.id,cantidad:text(quantity),producto:{...product,unidad:product.unidad}})}
          record={id,empresa_id:'1',usuario_id:'3',folio:input.folio??'TR-'+key,estado:'BORRADOR',fecha:now(),observaciones:input.observaciones,almacen_origen:inventoryWarehouse(input.almacen_origen_id),almacen_destino:inventoryWarehouse(input.almacen_destino_id),total_productos:details.length,detalles:details};state.transfers.push(record);kind='create';action='CREAR'
        }else{
          if(!record)return fail(404,'Traspaso no encontrado.')
          if(record.estado!=='BORRADOR')return fail(409,'La operación requiere un borrador.')
          if(match[2]==='cancel'){if(!input?.motivo?.trim())return fail(400,'Motivo obligatorio.');record.estado='CANCELADA';kind='cancel';action='CANCELAR'}else if(match[2]==='complete'){
            const plan=[]
            for(const line of record.detalles){const origin=state.stocks.get(record.almacen_origen.id+':'+line.producto_id),destination=state.stocks.get(record.almacen_destino.id+':'+line.producto_id),originAfter={...origin},destinationAfter={...destination},quantity=qty(line.cantidad);applyStock(originAfter,-quantity);applyStock(destinationAfter,quantity,origin.costo_promedio);plan.push({line,origin,destination,originAfter,destinationAfter,sourceCost:origin.costo_promedio})}
            for(const item of plan){changes.push({producto_id:item.line.producto_id,cantidad:item.line.cantidad,costo_unitario:item.sourceCost,origen:{almacen_id:record.almacen_origen.id,antes:stockState(item.origin),despues:stockState(item.originAfter)},destino:{almacen_id:record.almacen_destino.id,antes:stockState(item.destination),despues:stockState(item.destinationAfter)}});Object.assign(item.origin,item.originAfter);Object.assign(item.destination,item.destinationAfter);for(const[warehouse,type]of[[record.almacen_origen.id,'TRANSFERENCIA_SALIDA'],[record.almacen_destino.id,'TRANSFERENCIA_ENTRADA']])state.movements.push({id:String(nextMovement++),productId:item.line.producto_id,warehouseId:warehouse,tipo:type,cantidad:item.line.cantidad,costo_unitario:item.sourceCost,documento_tipo:'TRANSFERENCIA_ALMACEN',documento_id:record.id,documento_detalle_id:item.line.id,usuario_id:'3',motivo:null,fecha:now(),sync:null})}
            record.estado='COMPLETADA';kind='complete';action='COMPLETAR'
          }else return fail(404,'Ruta no disponible.')
        }
        transferId=record.id;result={transferencia:structuredClone(record),operacion:{accion:action,clave_idempotencia:key,usuario_id:'3',fecha:now(),motivo:action==='CANCELAR'?input.motivo:null},movimientos:state.movements.filter(row=>row.documento_tipo==='TRANSFERENCIA_ALMACEN'&&row.documento_id===record.id).map(transferMovement),existencias:changes,ecommerce:{eventos_creados:0,politica:'SIN_EVENTOS_ALMACENES_PENDIENTES'}}
      }
      const response={ok:true,replayed:false,data:structuredClone(result)};state.operations.set(key,{id:String(nextOperation++),hash,response,transferId})
      if(scenario==='fault-'+kind)return fail(503,'Respuesta perdida después del registro simulado.')
      return{status:kind==='adjust'||kind==='create'?201:200,body:response}
    }catch{return fail(409,'Existencia disponible insuficiente o límite de stock excedido.')}
  }
  // Adaptador opcional para el simulador conjunto. Valida todo antes de aplicar
  // existencias, movimientos y eventos; no llama a endpoints ni a PostgreSQL.
  function applyPurchase(scenario,record,kind){
    if(!['receive','cancel'].includes(kind)||record.empresa_id!=='1'||!['1','2'].includes(record.almacen_id))throw new Error('Compra fuera del contexto simulado.')
    const state=scenarioState(scenario),plan=[],seen=new Set()
    for(const line of record.compra_detalle){
      if(seen.has(line.producto_id))throw new Error('Producto repetido.');seen.add(line.producto_id)
      if(line.producto_id==='40')continue // Servicio sin control de inventario.
      const product=state.catalog.find(item=>item.id===line.producto_id),stock=state.stocks.get(record.almacen_id+':'+line.producto_id),quantity=qty(line.cantidad)
      if(!product||!stock||quantity<=0n||quantity%1000n||quantity>2147483647000n||!product.codigo_barras)throw new Error('Detalle incompatible con compra simulada.')
      cost(line.precio_unitario)
      if(kind==='cancel'&&quantity>qty(stock.disponible))return false
      const after={...stock};applyStock(after,kind==='receive'?quantity:-quantity,kind==='receive'?line.precio_unitario:null)
      plan.push({line,stock,after,quantity})
    }
    const date=now(),documentType=kind==='receive'?'COMPRA':'CANCELACION_COMPRA'
    for(const item of plan){
      Object.assign(item.stock,item.after)
      const eventId=String(++state.sync),operationId=`purchase:1:${record.id}:${item.line.id}:${kind}`
      state.movements.push({id:String(nextMovement++),productId:item.line.producto_id,warehouseId:record.almacen_id,tipo:kind==='receive'?'ENTRADA':'SALIDA',cantidad:item.line.cantidad,costo_unitario:item.line.precio_unitario,documento_tipo:documentType,documento_id:record.id,documento_detalle_id:item.line.id,usuario_id:record.usuario_id,motivo:kind==='receive'?'Recepción de compra '+record.folio:'Cancelación de compra '+record.folio,fecha:date,sync:{id:eventId,operation_id:operationId,adjustment:Number(item.quantity/1000n)*(kind==='receive'?1:-1),estado:'PENDIENTE',intentos:0,sincronizado_en:null}})
    }
    return true
  }
  function purchaseStock(scenario,warehouse='1',productId=inventoryProduct.id){return stockState(scenarioState(scenario).stocks.get(warehouse+':'+productId))}
  function saleAvailable(scenario,productId,warehouse){const stock=scenarioState(scenario).stocks.get(warehouse+':'+productId);return stock?qty(stock.disponible):0n}
  function applySale(scenario,sale,kind,details=null,documentId=null){
    if(!['create','cancel','return'].includes(kind)||sale.empresa.id!=='1'||!['1','2'].includes(sale.almacen.id))throw new Error('Venta fuera del contexto simulado.')
    const state=scenarioState(scenario),changes=new Map(),lines=[],outgoing=kind==='create'
    for(const detail of details??sale.detalles){
      const original=outgoing?detail:sale.detalles.find(item=>item.id===detail.venta_detalle_id)
      if(!original)throw new Error('Artículo ajeno a la venta.')
      if(!original.producto.controla_inventario)continue
      const product=state.catalog.find(item=>item.id===original.producto_id),stockKey=sale.almacen.id+':'+original.producto_id,stock=state.stocks.get(stockKey),quantity=qty(detail.cantidad)
      if(!product||!stock||quantity<=0n||quantity%1000n||quantity>2147483647000n||!product.codigo_barras)throw new Error('Artículo incompatible con inventario simulado.')
      const originalMovement=outgoing?null:state.movements.find(row=>row.documento_tipo==='VENTA'&&row.documento_id===sale.id&&row.documento_detalle_id===original.id&&row.tipo==='SALIDA')
      if(!outgoing&&!originalMovement)throw new Error('Falta el movimiento original de venta.')
      const sourceCost=outgoing?stock.costo_promedio:originalMovement.costo_unitario,after=changes.get(stockKey)?.after??{...stock}
      applyStock(after,outgoing?-quantity:quantity,outgoing?null:sourceCost)
      changes.set(stockKey,{stock,after});lines.push({original,detail,quantity,sourceCost})
    }
    const date=now(),documentType=kind==='return'?'DEVOLUCION_VENTA':'VENTA',id=documentId??sale.id
    for(const change of changes.values())Object.assign(change.stock,change.after)
    for(const item of lines){
      const eventId=String(++state.sync),operationId=`sale:1:${sale.id}:${kind}:${id}:${item.detail.id??item.original.id}`
      state.movements.push({id:String(nextMovement++),productId:item.original.producto_id,warehouseId:sale.almacen.id,tipo:outgoing?'SALIDA':'ENTRADA',cantidad:text(item.quantity),costo_unitario:item.sourceCost,documento_tipo:documentType,documento_id:id,documento_detalle_id:kind==='return'?item.detail.id:item.original.id,usuario_id:'3',motivo:(outgoing?'Venta ':kind==='cancel'?'Cancelación de venta ':'Devolución de venta ')+sale.folio,fecha:date,sync:{id:eventId,operation_id:operationId,adjustment:Number(item.quantity/1000n)*(outgoing?-1:1),estado:'PENDIENTE',intentos:0,sincronizado_en:null}})
    }
  }
  return{handle,applyPurchase,purchaseStock,saleAvailable,applySale,summary:()=>({scenarios:[...scenarios].map(([name,state])=>({name,stocks:Object.fromEntries([...state.stocks].map(([key,row])=>[key,stockState(row)])),movements:state.movements.length,transfers:state.transfers.length,operations:state.operations.size,events:state.sync})),requests})}
}
