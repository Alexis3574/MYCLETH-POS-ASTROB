// Simulación en memoria, independiente de los cálculos frontend y de PostgreSQL.
const ok = (data, status = 200) => ({ status, body: { ok: true, data: structuredClone(data) } })
const fail = (status, message, code = 'PURCHASE_FIXTURE_ERROR') => ({ status, body: { ok: false, message, code } })
const now = () => new Date().toISOString()
function units(value, scale) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value))
  if (!match || (match[2] || '').length > scale) throw new Error('Decimal inválido')
  return BigInt(match[1]) * 10n ** BigInt(scale) + BigInt((match[2] || '').padEnd(scale,'0'))
}
const decimal = (value, scale = 2) => value / 10n ** BigInt(scale) + '.' + String(value % 10n ** BigInt(scale)).padStart(scale, '0')
const rounded = (value, divisor) => (value + divisor / 2n) / divisor
export const sampleSupplier = { id: '9007199254741010', empresa_id: '1', codigo: 'PROV-QA', razon_social: 'Proveedor de prueba aislada', nombre_comercial: 'Abasto QA', rfc: 'AAA010101AAA', email: 'proveedor@example.test', telefono: null, contacto: 'Contacto de prueba', dias_credito: 15, activo: true }
const suppliers = [sampleSupplier, { ...sampleSupplier, id: '9007199254741011', codigo: 'PROV-INACTIVO', razon_social: 'Proveedor inactivo', activo: false }]
const methods = [{ id: '1', codigo: 'TRANSFERENCIA', nombre: 'Transferencia', es_efectivo: false }, { id: '2', codigo: 'EFECTIVO', nombre: 'Efectivo', es_efectivo: true }, { id: '3', codigo: 'CREDITO', nombre: 'Crédito', es_efectivo: false }]
export const samplePurchaseInput = () => ({ sucursal_id: '2', almacen_id: '1', proveedor_id: sampleSupplier.id, folio: 'COMPRA-QA', factura_proveedor: null, observaciones: null, detalles: [{ producto_id: '9007199254740993', descripcion: null, cantidad: '2.000', precio_unitario: '100.0000', descuento_porcentaje: '0.0000', tasa_impuesto: '16.0000' }] })
export function createPurchaseFixtureState(inventory = null) {
  const scenarios = new Map(), requests = []
  let nextId = 9007199254742000n, nextPayment = 9007199254743000n
  function makeRecord(input) {
    if (input?.sucursal_id !== '2' || input.almacen_id !== '1' || input.proveedor_id !== sampleSupplier.id || !input.folio?.trim() || input.folio.length > 50 || !Array.isArray(input.detalles) || !input.detalles.length || input.detalles.length > 100) throw new Error('Contexto inválido')
    const id = String(nextId++), seen = new Set(), lines = []
    let subtotal = 0n, discount = 0n, tax = 0n
    for (const [index, item] of input.detalles.entries()) {
      if (!['9007199254740993','40'].includes(item.producto_id) || seen.has(item.producto_id)) throw new Error('Producto inválido')
      seen.add(item.producto_id)
      const quantity = units(item.cantidad,3), price = units(item.precio_unitario,4), percentage = units(item.descuento_porcentaje,4), rate = units(item.tasa_impuesto,4)
      if (quantity <= 0n || item.producto_id !== '40' && quantity % 1000n || percentage > 1000000n || rate > 1000000n) throw new Error('Detalle inválido')
      const base = rounded(quantity * price,100000n), reduction = rounded(base * percentage,1000000n), taxes = rounded((base-reduction)*rate,1000000n)
      subtotal += base; discount += reduction; tax += taxes
      lines.push({ ...item, id: String(index + 1), compra_id: id, cantidad: decimal(quantity,3), precio_unitario: decimal(price,4), descuento_porcentaje: decimal(percentage,4), tasa_impuesto: decimal(rate,4), subtotal_linea: decimal(base), descuento_importe: decimal(reduction), impuesto_importe: decimal(taxes), total_linea: decimal(base-reduction+taxes), producto: { id: item.producto_id, nombre: item.producto_id === '40' ? 'Servicio por hora' : 'Artículo de prueba', sku: item.producto_id === '40' ? 'SERV-001' : 'P-001' } })
    }
    return { id, empresa_id: '1', usuario_id: '3', sucursal_id:'2', almacen_id:'1', proveedor_id: sampleSupplier.id, folio: input.folio, factura_proveedor: input.factura_proveedor, observaciones: input.observaciones, fecha: now(), estado:'BORRADOR', subtotal:decimal(subtotal), descuento:decimal(discount), impuesto:decimal(tax), total:decimal(subtotal-discount+tax), proveedor: { id:sampleSupplier.id,codigo:sampleSupplier.codigo,razon_social:sampleSupplier.razon_social,activo:true }, sucursal:{id:'2',codigo:'S-1',nombre:'Sucursal 1'}, almacen:{id:'1',codigo:'A-1',nombre:'Almacén 1'}, compra_detalle:lines, compra_pago:[], resumen_financiero:{total_pagado:'0.00',saldo_pendiente:decimal(subtotal-discount+tax)} }
  }
  function getState(scenario) {
    if (!scenarios.has(scenario)) {
      const state = { rows:[], operations:new Map(), movements:[], cashMovements:[], stock:10, cash:'500.00' }
      if (!['normal','fault-create','slow-create','read-only','no-permission'].includes(scenario)) {
        const count = scenario === 'paged' ? 23 : 1
        for (let index=0; index<count; index++) {
          const row = makeRecord({ ...samplePurchaseInput(), folio: 'COMPRA-SEED-' + (index+1) })
          if (scenario === 'fault-pay' || scenario === 'fault-cancel' || scenario === 'stock-insufficient' || scenario === 'cash-other') { row.estado = 'RECIBIDA'; state.stock += 2; inventory?.applyPurchase(scenario,row,'receive') }
          state.rows.push(row)
        }
        if (scenario === 'stock-insufficient') state.stock = 0
      }
      scenarios.set(scenario,state)
    }
    return scenarios.get(scenario)
  }
  function paged(rows, url) {
    const page=Number(url.searchParams.get('page')||1), pageSize=Number(url.searchParams.get('pageSize')||20)
    return ok({ items:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,page,pageSize })
  }
  function handle(method,url,scenario='normal',input=null,key=null) {
    const route=url.pathname.replace(/^\/api\/v1/,'')
    if (!route.startsWith('/purchases') && !route.startsWith('/suppliers')) return null
    requests.push({method,route,scenario,key})
    if (scenario==='no-permission' || scenario==='no-suppliers' && route.startsWith('/suppliers') || scenario==='read-only' && method!=='GET') return fail(403,'No tienes permiso para esta operación.')
    if (route.startsWith('/suppliers')) {
      if (method!=='GET') return fail(403,'El simulador solo permite consultar proveedores.')
      if (route==='/suppliers') {
        if (scenario==='supplier-malformed') return ok({items:[{id:sampleSupplier.id}],total:1,page:1,pageSize:20})
        const query=(url.searchParams.get('q')||'').toLowerCase(),active=url.searchParams.get('activo')
        return paged(suppliers.filter(row=>(active===null || String(row.activo)===active) && [row.razon_social,row.codigo,row.rfc,row.email,row.contacto].some(value=>String(value||'').toLowerCase().includes(query))),url)
      }
      const row=suppliers.find(item=>route==='/suppliers/'+item.id)
      return row ? ok({...row,proveedor_direccion:[{id:'1',proveedor_id:row.id,tipo:'FISCAL',calle:'Calle de prueba',numero_exterior:'10',numero_interior:null,colonia:null,municipio:'Municipio QA',estado:null,codigo_postal:'00000',pais:'México',es_principal:true}]}) : fail(404,'Proveedor no encontrado.')
    }
    const state=getState(scenario)
    if (method==='GET' && route==='/purchases') return paged([...state.rows].reverse().filter(row=>(!url.searchParams.get('estado')||row.estado===url.searchParams.get('estado'))&&(!url.searchParams.get('proveedor_id')||row.proveedor_id===url.searchParams.get('proveedor_id'))),url)
    const match=/^\/purchases\/(\d+)(?:\/(receive|payments|cancel))?$/.exec(route)
    const row=match&&state.rows.find(item=>item.id===match[1])
    if (method==='GET') {
      if (!row) return fail(404,'Compra no encontrada.')
      return scenario==='purchase-malformed' ? ok({...row,compra_detalle:null}) : ok(row)
    }
    if (method!=='POST' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key||'')) return fail(400,'Idempotency-Key UUID obligatorio.')
    const hash=JSON.stringify({route,input}), previous=state.operations.get(key)
    if (previous) return previous.hash===hash ? ok({replayed:true,data:previous.data},route==='/purchases'||route.endsWith('/payments')?201:200) : fail(409,'La clave pertenece a otra solicitud.','PURCHASE_IDEMPOTENCY_CONFLICT')
    let result,kind,status=200
    try {
      if (route==='/purchases') {
        if (state.rows.some(item=>item.folio===input?.folio)) return fail(409,'El folio ya existe.','PURCHASE_DUPLICATE')
        result=makeRecord(input); state.rows.push(result); kind='create'; status=201
      } else {
        if (!row) return fail(404,'Compra no encontrada.')
        kind=match[2]==='receive'?'receive':match[2]==='payments'?'pay':'cancel'
        if (kind==='receive') {
          if (row.estado!=='BORRADOR') return fail(409,'Solo se reciben borradores.')
          if (inventory && !inventory.applyPurchase(scenario,row,'receive')) return fail(409,'No se pudo recibir el inventario simulado.')
          row.estado='RECIBIDA'
          for (const detail of row.compra_detalle.filter(item=>item.producto_id!=='40')) { state.stock+=Number(detail.cantidad); state.movements.push({kind:'ENTRADA',purchase:row.id,quantity:detail.cantidad}) }
        } else if (kind==='pay') {
          if (row.estado!=='RECIBIDA') return fail(409,'Solo se pagan compras recibidas.')
          const amount=units(input?.monto,2),method=methods.find(item=>item.id===input?.metodo_pago_id),paid=units(row.resumen_financiero.total_pagado,2)
          if (!method || amount<=0n || paid+amount>units(row.total,2)) return fail(422,'Pago inválido o mayor que el saldo.')
          if (method.es_efectivo && (input.sesion_caja_id!=='6'||scenario==='cash-other'||amount>units(state.cash,2)) || !method.es_efectivo && input.sesion_caja_id!==null) return fail(422,'Sesión de caja o efectivo no válidos.')
          const payment={...input,id:String(nextPayment++),compra_id:row.id,monto:decimal(amount),fecha:now(),metodo_pago:method}
          row.compra_pago.push(payment)
          row.resumen_financiero={total_pagado:decimal(paid+amount),saldo_pendiente:decimal(units(row.total,2)-paid-amount)}
          if (method.es_efectivo) { state.cash=decimal(units(state.cash,2)-amount);state.cashMovements.push({payment:payment.id,amount:payment.monto}) }
          status=201
        } else {
          if (row.estado==='CANCELADA'||row.compra_pago.length) return fail(409,'No se puede cancelar una compra cancelada o con pagos.')
          if (typeof input?.motivo!=='string'||!input.motivo.trim()||input.motivo.length>250) return fail(400,'Motivo obligatorio.')
          if (row.estado==='RECIBIDA') {
            const quantity=row.compra_detalle.filter(item=>item.producto_id!=='40').reduce((sum,line)=>sum+Number(line.cantidad),0)
            if (inventory ? !inventory.applyPurchase(scenario,row,'cancel') : state.stock<quantity) return fail(409,'Existencia disponible insuficiente para cancelar.')
            state.stock-=quantity
            for (const detail of row.compra_detalle.filter(item=>item.producto_id!=='40')) state.movements.push({kind:'SALIDA',purchase:row.id,quantity:detail.cantidad})
          }
          row.estado='CANCELADA'
        }
        result=row
      }
      const snapshot=structuredClone(result)
      state.operations.set(key,{hash,data:snapshot})
      if (scenario==='fault-'+kind) return fail(503,'Respuesta de prueba perdida después de registrar.')
      return {...ok({replayed:false,data:snapshot},status),...(scenario==='slow-create'?{delay:1500}:{})}
    } catch { return fail(422,'Datos de compra no válidos.') }
  }
  return {handle,summary:()=>({scenarios:[...scenarios].map(([name,state])=>({name,purchases:state.rows.length,payments:state.rows.reduce((sum,row)=>sum+row.compra_pago.length,0),movements:structuredClone(state.movements),stock:inventory?Number(inventory.purchaseStock(name).cantidad):state.stock,cash:state.cash,cashMovements:state.cashMovements.length,operations:state.operations.size})),requests})}
}
