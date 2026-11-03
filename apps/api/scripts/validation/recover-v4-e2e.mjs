/** Fixture-only E2E recovery, with read-only inspection and rollback rehearsal. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import {guard} from '../../tests/integral/v4-safety.mjs';

const mode=process.argv[2];
const marker=process.argv[3];
assert.ok(['--inspect','--dry-run','--apply'].includes(mode),'Uso: --inspect|--dry-run|--apply V4_E2E_<12 hex>');
assert.match(marker??'',/^V4_E2E_[0-9a-f]{12}$/,'Marcador de fixture E2E inválido');
guard({write:mode!=='--inspect'});
if(mode==='--apply')assert.equal(process.env.POS_V4_RECOVERY_CONFIRM,marker,'Confirma el marcador exacto con POS_V4_RECOVERY_CONFIRM');
const suffix=marker.slice('V4_E2E_'.length);
const {prisma}=await import('../../src/lib/prisma.ts');

async function identify(tx) {
  const db=await tx.$queryRaw`SELECT current_database() AS name, current_schema() AS schema`;
  assert.equal(db[0]?.name,'pos_novnix');
  const company=await tx.empresa.findMany({where:{razon_social:marker},select:{id:true,razon_social:true,nombre_comercial:true}});
  assert.equal(company.length,1,'El marcador no identifica exactamente una empresa');
  assert.equal(company[0].nombre_comercial,marker,'Nombre comercial diferente al marcador');
  const companyId=company[0].id;
  const exactlyOne=async (table,where,label)=>{
    const rows=await tx[table].findMany({where,select:{id:true}});
    assert.equal(rows.length,1,`Se esperaba exactamente 1 ${label}; encontrados ${rows.length}`);
    return rows[0].id;
  };
  const branchId=await exactlyOne('sucursal',{empresa_id:companyId,codigo:'V4'},'sucursal');
  assert.equal(await tx.sucursal.count({where:{empresa_id:companyId}}),1,'Empresa tiene sucursales adicionales');
  const warehouseRows=await tx.almacen.findMany({where:{sucursal_id:branchId},select:{id:true,codigo:true}});
  assert.deepEqual(warehouseRows.map(r=>r.codigo).sort(),['DESTINO','ORIGEN'],'Almacenes inesperados');
  const userId=await exactlyOne('usuario',{empresa_id:companyId,username:`v4_${suffix}`},'usuario');
  assert.equal(await tx.usuario.count({where:{empresa_id:companyId}}),1,'Empresa tiene usuarios adicionales');
  const productId=await exactlyOne('producto',{empresa_id:companyId,sku:`V4_${suffix}`,codigo_barras:`V4BAR_${suffix}`},'producto');
  assert.equal(await tx.producto.count({where:{empresa_id:companyId}}),1,'Empresa tiene productos adicionales');
  const supplierId=await exactlyOne('proveedor',{empresa_id:companyId,codigo:`V4_${suffix}`},'proveedor');
  assert.equal(await tx.proveedor.count({where:{empresa_id:companyId}}),1,'Empresa tiene proveedores adicionales');
  const roleId=await exactlyOne('rol',{codigo:`V4_${suffix}`},'rol exclusivo');
  const unitId=await exactlyOne('unidad_medida',{codigo:`V4${suffix}`},'unidad exclusiva');
  const methodId=await exactlyOne('metodo_pago',{codigo:`V4_${suffix}`},'método de pago exclusivo');
  const saleId=await exactlyOne('venta',{empresa_id:companyId,folio:`${marker}_SALE`},'venta');
  assert.equal(await tx.venta.count({where:{empresa_id:companyId}}),1,'Empresa tiene ventas adicionales');
  const purchaseId=await exactlyOne('compra',{empresa_id:companyId,folio:`${marker}_PURCHASE`},'compra');
  assert.equal(await tx.compra.count({where:{empresa_id:companyId}}),1,'Empresa tiene compras adicionales');
  const transferId=await exactlyOne('transferencia_almacen',{empresa_id:companyId},'transferencia');
  const sale=await tx.venta.findUnique({where:{id:saleId},select:{estado:true,usuario_id:true,sucursal_id:true,almacen_id:true}});
  const purchase=await tx.compra.findUnique({where:{id:purchaseId},select:{estado:true,usuario_id:true,sucursal_id:true,almacen_id:true}});
  const transfer=await tx.transferencia_almacen.findUnique({where:{id:transferId},select:{estado:true,usuario_id:true,almacen_origen_id:true,almacen_destino_id:true}});
  assert.equal(sale.usuario_id,userId);assert.equal(sale.sucursal_id,branchId);
  assert.equal(purchase.usuario_id,userId);assert.equal(purchase.sucursal_id,branchId);
  assert.equal(transfer.usuario_id,userId);
  const warehouseIds=warehouseRows.map(r=>r.id);
  assert.ok(warehouseIds.includes(sale.almacen_id));
  assert.ok(warehouseIds.includes(purchase.almacen_id));
  assert.ok(warehouseIds.includes(transfer.almacen_origen_id)&&warehouseIds.includes(transfer.almacen_destino_id));
  assert.equal(sale.estado,'COMPLETADA');
  assert.equal(purchase.estado,'RECIBIDA');
  assert.equal(transfer.estado,'COMPLETADA');
  const nReturns=await tx.devolucion_venta.count({where:{venta_id:saleId}});
  assert.equal(nReturns,1,'Esperada exactamente una devolución');
  assert.equal(await tx.usuario_rol.count({where:{rol_id:roleId}}),1,'Rol compartido con más usuarios');
  assert.equal(await tx.producto.count({where:{unidad_medida_id:unitId}}),1,'Unidad compartida con más productos');
  assert.equal(await tx.venta_pago.count({where:{metodo_pago_id:methodId}}),1,'Método utilizado en otros pagos');
  const totals={
    auditorias:await tx.auditoria.count({where:{usuario_id:userId}}),
    ventas:await tx.venta.count({where:{empresa_id:companyId}}),
    devoluciones:nReturns,
    compras:await tx.compra.count({where:{empresa_id:companyId}}),
    transferencias:await tx.transferencia_almacen.count({where:{empresa_id:companyId}}),
    movimientos:await tx.movimiento_inventario.count({where:{producto_id:productId}}),
    outbox:await tx.sincronizacion_ecommerce_inventario.count({where:{movimiento_inventario:{producto_id:productId}}}),
  };
  return {companyId,branchId,userId,productId,supplierId,roleId,unitId,methodId,saleId,purchaseId,transferId,totals};
}

async function cleanup(tx,f){
  // ALL mutations execute in one transaction. No triggers are disabled.
  const owned=await identify(tx);
  assert.equal(owned.companyId,f.companyId,'Identidad de fixture cambió entre verificaciones');
  await tx.auditoria.deleteMany({where:{usuario_id:f.userId}});
  await tx.operacion_transferencia.deleteMany({where:{empresa_id:f.companyId}});
  await tx.operacion_compra.deleteMany({where:{empresa_id:f.companyId}});
  await tx.sincronizacion_ecommerce_inventario.deleteMany({where:{movimiento_inventario:{producto_id:f.productId}}});
  await tx.devolucion_pago.deleteMany({where:{devolucion_venta:{venta:{empresa_id:f.companyId}}}});
  await tx.devolucion_venta_detalle.deleteMany({where:{devolucion_venta:{venta:{empresa_id:f.companyId}}}});
  await tx.devolucion_venta.deleteMany({where:{venta:{empresa_id:f.companyId}}});
  await tx.venta_pago.deleteMany({where:{venta:{empresa_id:f.companyId}}});
  // PostgreSQL intentionally protects sale details of completed documents.
  const saleReset=await tx.venta.updateMany({where:{id:f.saleId,empresa_id:f.companyId,estado:'COMPLETADA',folio:`${marker}_SALE`},data:{estado:'BORRADOR'}});
  assert.equal(saleReset.count,1,'No se pudo habilitar limpieza de venta exclusivamente sintética');
  await tx.venta_detalle.deleteMany({where:{venta:{empresa_id:f.companyId}}});
  await tx.venta.deleteMany({where:{empresa_id:f.companyId}});
  await tx.compra_pago.deleteMany({where:{compra:{empresa_id:f.companyId}}});
  const purchaseReset=await tx.compra.updateMany({where:{id:f.purchaseId,empresa_id:f.companyId,estado:'RECIBIDA'},data:{estado:'BORRADOR'}});
  assert.equal(purchaseReset.count,1,'No se pudo habilitar limpieza de compra sintética');
  await tx.compra_detalle.deleteMany({where:{compra:{empresa_id:f.companyId}}});
  await tx.compra.deleteMany({where:{empresa_id:f.companyId}});
  // Transfer details are also immutable while the transfer is completed.
  const transferReset=await tx.transferencia_almacen.updateMany({where:{id:f.transferId,empresa_id:f.companyId,estado:'COMPLETADA'},data:{estado:'BORRADOR'}});
  assert.equal(transferReset.count,1,'No se pudo habilitar limpieza de transferencia sintética');
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
  assert.equal(await tx.empresa.count({where:{razon_social:marker}}),0,'La empresa sintética no se eliminó');
}

class PreviewRollback extends Error {}
try {
  const f=await prisma.$transaction(async tx=>identify(tx),{timeout:20000});
  const display=Object.fromEntries(Object.entries(f).map(([k,v])=>[k,typeof v==='bigint'?v.toString():v]));
  console.log('FIXTURE EXCLUSIVO VERIFICADO:',JSON.stringify({marker,...display},null,2));
  if(mode==='--inspect'){console.log('SOLO LECTURA: ninguna modificación.');}
  else {
    try {
      await prisma.$transaction(async tx=>{await cleanup(tx,f);throw new PreviewRollback('SIMULACION: ROLLBACK INTENCIONAL');},{timeout:30000});
      throw new Error('No se verificó el rollback');
    }catch(e){if(!(e instanceof PreviewRollback))throw e;}
    assert.equal(await prisma.empresa.count({where:{razon_social:marker}}),1,'El ensayo cambió datos persistentes');
    console.log('DRY RUN APROBADO: limpieza completa dentro de transacción y ROLLBACK confirmado.');
    if(mode==='--apply'){
      await prisma.$transaction(async tx=>{await cleanup(tx,f);},{timeout:30000});
      assert.equal(await prisma.empresa.count({where:{razon_social:marker}}),0,'Fixture residual detectado');
      assert.equal(await prisma.rol.count({where:{codigo:`V4_${suffix}`}}),0);
      assert.equal(await prisma.metodo_pago.count({where:{codigo:`V4_${suffix}`}}),0);
      assert.equal(await prisma.unidad_medida.count({where:{codigo:`V4${suffix}`}}),0);
      console.log('RECUPERACION APLICADA: solo fixture identificado; sin desactivar triggers ni borrar datos históricos.');
    }
  }
}finally {await prisma.$disconnect();}
