/** Real business flow: purchase -> receive -> transfer -> sale -> return -> reports, with owned cleanup. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {guard,localApp,http,dateInZone} from './v4-safety.mjs';
guard({write:true});
const suffix=randomUUID().replaceAll('-','').slice(0,12);
const marker=`V4_E2E_${suffix}`;
const f={companyId:null,branchId:null,originId:null,destId:null,userId:null,productId:null,supplierId:null,unitId:null,roleId:null,methodId:null};
let created=false;let runtime;
async function fixture(tx){
  const permission=await tx.permiso.findMany({where:{codigo:{in:['INVENTARIO.TRANSFERIR','REPORTES.VER','VENTAS.VER','COMPRAS.VER','INVENTARIO.VER','DASHBOARD.VER','CAJAS.VER']}},select:{id:true,codigo:true}});
  assert.equal(permission.length,7,'Permisos M17/M16/Transferencia incompletos');
  const c=await tx.empresa.create({data:{razon_social:marker,nombre_comercial:marker,zona_horaria:'America/Mexico_City'}});f.companyId=c.id;
  const b=await tx.sucursal.create({data:{empresa_id:c.id,codigo:'V4',nombre:'Sucursal integral v4'}});f.branchId=b.id;
  const o=await tx.almacen.create({data:{sucursal_id:b.id,codigo:'ORIGEN',nombre:'Origen'}});f.originId=o.id;
  const d=await tx.almacen.create({data:{sucursal_id:b.id,codigo:'DESTINO',nombre:'Destino'}});f.destId=d.id;
  const u=await tx.usuario.create({data:{empresa_id:c.id,username:`v4_${suffix}`,password_hash:'TEST_ONLY_NO_LOGIN',nombre:'Usuario integral'}});f.userId=u.id;
  await tx.usuario_sucursal.create({data:{usuario_id:u.id,sucursal_id:b.id}});
  const role=await tx.rol.create({data:{codigo:`V4_${suffix}`,nombre:'V4 E2E'}});f.roleId=role.id;
  for(const p of permission)await tx.rol_permiso.create({data:{rol_id:role.id,permiso_id:p.id}});
  await tx.usuario_rol.create({data:{usuario_id:u.id,rol_id:role.id}});
  const unit=await tx.unidad_medida.create({data:{codigo:`V4${suffix}`,nombre:'Unidad integral'}});f.unitId=unit.id;
  const product=await tx.producto.create({data:{empresa_id:c.id,unidad_medida_id:unit.id,sku:`V4_${suffix}`,codigo_barras:`V4BAR_${suffix}`,nombre:'Producto integral',controla_inventario:true,precio_venta:'100.00',costo_referencia:'12.5000'}});f.productId=product.id;
  const supplier=await tx.proveedor.create({data:{empresa_id:c.id,codigo:`V4_${suffix}`,razon_social:'Proveedor integral'}});f.supplierId=supplier.id;
  const method=await tx.metodo_pago.create({data:{codigo:`V4_${suffix}`,nombre:'Pago no efectivo V4',es_efectivo:false}});f.methodId=method.id;
  return {c,b,o,d,u,product};
}
async function remove(prisma){
  if(!created)return;
  await prisma.$transaction(async tx=>{
    const owned=await tx.empresa.findUnique({where:{id:f.companyId},select:{razon_social:true}});
    assert.equal(owned?.razon_social,marker,'Limpieza rechazada: marcador empresarial incorrecto');
    await tx.auditoria.deleteMany({where:{usuario_id:f.userId}});
    await tx.operacion_transferencia.deleteMany({where:{empresa_id:f.companyId}});
    await tx.operacion_compra.deleteMany({where:{empresa_id:f.companyId}});
    await tx.sincronizacion_ecommerce_inventario.deleteMany({where:{movimiento_inventario:{producto_id:f.productId}}});
    await tx.devolucion_pago.deleteMany({where:{devolucion_venta:{venta:{empresa_id:f.companyId}}}});
    await tx.devolucion_venta_detalle.deleteMany({where:{devolucion_venta:{venta:{empresa_id:f.companyId}}}});
    await tx.devolucion_venta.deleteMany({where:{venta:{empresa_id:f.companyId}}});
    await tx.venta_pago.deleteMany({where:{venta:{empresa_id:f.companyId}}});
    // Solo fixture marcado: el trigger permite editar detalles de venta BORRADOR.
    const saleReset=await tx.venta.updateMany({where:{empresa_id:f.companyId,folio:`${marker}_SALE`,estado:'COMPLETADA'},data:{estado:'BORRADOR'}});
    assert.equal(saleReset.count,1,'La venta sintética no está en el estado esperado');
    await tx.venta_detalle.deleteMany({where:{venta:{empresa_id:f.companyId}}});
    await tx.venta.deleteMany({where:{empresa_id:f.companyId}});
    await tx.compra_pago.deleteMany({where:{compra:{empresa_id:f.companyId}}});
    await tx.compra.updateMany({where:{empresa_id:f.companyId,estado:{in:['RECIBIDA','CANCELADA']}},data:{estado:'BORRADOR'}});
    await tx.compra_detalle.deleteMany({where:{compra:{empresa_id:f.companyId}}});
    await tx.compra.deleteMany({where:{empresa_id:f.companyId}});
    // Solo fixture marcado: transferencia completada protege sus detalles.
    const transferReset=await tx.transferencia_almacen.updateMany({where:{empresa_id:f.companyId,estado:'COMPLETADA'},data:{estado:'BORRADOR'}});
    assert.equal(transferReset.count,1,'La transferencia sintética no está en el estado esperado');
    await tx.transferencia_detalle.deleteMany({where:{transferencia_almacen:{empresa_id:f.companyId}}});
    await tx.transferencia_almacen.deleteMany({where:{empresa_id:f.companyId}});
    await tx.movimiento_caja.deleteMany({where:{usuario_id:f.userId}});
    await tx.movimiento_inventario.deleteMany({where:{producto_id:f.productId}});
    await tx.existencia.deleteMany({where:{producto_id:f.productId}});
    await tx.producto.delete({where:{id:f.productId}});
    await tx.proveedor.delete({where:{id:f.supplierId}});
    await tx.almacen.deleteMany({where:{sucursal_id:f.branchId}});
    await tx.usuario_sucursal.deleteMany({where:{usuario_id:f.userId}});
    await tx.usuario_rol.deleteMany({where:{usuario_id:f.userId}});
    await tx.usuario.delete({where:{id:f.userId}});
    await tx.sucursal.delete({where:{id:f.branchId}});
    await tx.empresa.delete({where:{id:f.companyId}});
    await tx.rol.delete({where:{id:f.roleId}});
    await tx.unidad_medida.delete({where:{id:f.unitId}});
    await tx.metodo_pago.delete({where:{id:f.methodId}});
  },{timeout:30000});
  created=false;
  assert.equal(await prisma.empresa.count({where:{razon_social:marker}}),0);
}
try {
  runtime=await localApp();const {prisma,tokenService,base}=runtime;
  await prisma.$transaction(fixture,{timeout:30000});created=true;
  const {purchaseService}=await import('../../src/modules/purchases/services/purchase.service.ts');
  const {purchaseCreateSchema}=await import('../../src/modules/purchases/purchase.schema.ts');
  const {transferWriteService}=await import('../../src/modules/transfers/services/transfer-write.service.ts');
  const {createTransferSchema}=await import('../../src/modules/transfers/transfer.schema.ts');
  const {saleService}=await import('../../src/modules/sales/sale.service.ts');
  const {saleReturnService}=await import('../../src/modules/sales/returns/services/sale-return.service.ts');
  const actor={empresaId:f.companyId,userId:f.userId};
  const stock=async warehouse=>{
    const row=await prisma.existencia.findUnique({where:{producto_id_almacen_id:{producto_id:f.productId,almacen_id:warehouse}}});
    return row?row.cantidad.toFixed(3):'0.000';
  };
  const input=purchaseCreateSchema.parse({sucursal_id:String(f.branchId),almacen_id:String(f.originId),proveedor_id:String(f.supplierId),folio:`${marker}_PURCHASE`,detalles:[{producto_id:String(f.productId),cantidad:'3',precio_unitario:'12.5000',tasa_impuesto:'0'}]});
  const purchase=await purchaseService.create(actor,input,randomUUID());
  assert.equal(purchase.replayed,false);
  const purchaseId=BigInt(purchase.data.id);
  await purchaseService.receive(actor,purchaseId,randomUUID());
  assert.equal(await stock(f.originId),'3.000','Recepción no incrementó existencias');
  const transferInput=createTransferSchema.parse({almacen_origen_id:String(f.originId),almacen_destino_id:String(f.destId),detalles:[{producto_id:String(f.productId),cantidad:'2.000'}]});
  const tr=await transferWriteService.create(actor,transferInput,randomUUID());
  const transferId=BigInt(tr.data.transferencia.id);
  const completed=await transferWriteService.complete(actor,transferId,randomUUID());
  assert.equal(completed.data.transferencia.estado,'COMPLETADA');
  assert.equal(await stock(f.originId),'1.000');
  assert.equal(await stock(f.destId),'2.000');
  const sale=await saleService.createSale({empresaId:f.companyId,sucursalId:f.branchId,almacenId:f.destId,usuarioId:f.userId,folio:`${marker}_SALE`,detalles:[{productoId:f.productId,cantidad:1,descuentoPorcentaje:0}],pagos:[{metodoPagoId:f.methodId,monto:100}]});
  assert.equal(sale.estado,'COMPLETADA');
  assert.equal(sale.total,100);
  assert.equal(await stock(f.destId),'1.000');
  const saleId=BigInt(sale.id);
  const saleDocument=await prisma.venta.findUnique({where:{id:saleId},select:{venta_detalle:{select:{id:true}},venta_pago:{select:{id:true}}}});
  assert.equal(saleDocument?.venta_detalle.length,1);assert.equal(saleDocument?.venta_pago.length,1);
  const refund=await saleReturnService.createReturn({saleId,empresaId:f.companyId,usuarioId:f.userId,folio:`${marker}_RETURN`,motivo:'Ensayo de flujo completo',detalles:[{saleDetailId:saleDocument.venta_detalle[0].id,cantidad:1}],reembolsos:[{salePaymentId:saleDocument.venta_pago[0].id,monto:100}]});
  assert.equal(refund.total,100);
  assert.equal(await stock(f.destId),'2.000');
  const movements=await prisma.movimiento_inventario.findMany({where:{producto_id:f.productId},select:{tipo:true,documento_tipo:true,almacen_id:true,cantidad:true}});
  assert.ok(movements.some(m=>m.documento_tipo==='COMPRA'&&m.tipo==='ENTRADA'));
  assert.ok(movements.some(m=>m.tipo==='TRANSFERENCIA_SALIDA'));
  assert.ok(movements.some(m=>m.tipo==='TRANSFERENCIA_ENTRADA'));
  assert.ok(movements.some(m=>m.tipo==='SALIDA'&&m.almacen_id===f.destId));
  assert.ok(movements.some(m=>m.tipo==='ENTRADA'&&m.almacen_id===f.destId));
  const outbox=await prisma.sincronizacion_ecommerce_inventario.count({where:{movimiento_inventario:{producto_id:f.productId}}});
  assert.ok(outbox>=3,`Eventos outbox insuficientes: ${outbox}`);
  const token=await tokenService.createAccessToken({userId:f.userId,empresaId:f.companyId});
  const day=dateInZone();
  const query=`?sucursal_id=${f.branchId}&fecha_desde=${day}&fecha_hasta=${day}&limit=50`;
  for(const [name,expectedMin] of [['ventas',1],['devoluciones',1],['compras',1],['inventario',5]]){
    const r=await http(base,`/api/v1/reports/${name}${query}`,token);
    assert.equal(r.status,200,JSON.stringify(r.body));
    assert.ok(r.body?.data?.pagination?.total>=expectedMin,`${name} no refleja flujo E2E`);
  }
  const report=await http(base,`/api/v1/dashboard/summary?fecha_desde=${day}&fecha_hasta=${day}&sucursal_id=${f.branchId}`,token);
  assert.equal(report.status,200,JSON.stringify(report.body));
  console.log(JSON.stringify({status:'PASS',kind:'ONE_BUSINESS_E2E_PURCHASE_TRANSFER_SALE_RETURN',steps:5,stock_origin:'1.000',stock_destination:'2.000',movement_count:movements.length,outbox_count:outbox,reports_checked:4,dashboard:true,marker},null,2));
} catch(e){console.error('V4 E2E ERROR',e.stack||e);process.exitCode=1;}
finally {if(runtime){try{await remove(runtime.prisma);console.log('V4 E2E CLEANUP PASS');}catch(e){console.error('V4 E2E CLEANUP FAILED: marker',marker,e);process.exitCode=1;}await runtime.close();}}
