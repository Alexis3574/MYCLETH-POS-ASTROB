/** Multi-company and partial branch permissions via actual HTTP against committed synthetic fixtures. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {guard,localApp,http,dateInZone} from './v4-safety.mjs';
guard({write:true});
const marker=`V4_TENANT_${randomUUID().replaceAll('-','').slice(0,12)}`;
const ids={companies:[],branches:[],users:[],role:null,unit:null,products:[]};
let seeded=false;let runtime;
async function seed(tx){
  const perms=['REPORTES.VER','VENTAS.VER','PRODUCTOS.VER','INVENTARIO.VER','CAJAS.VER','COMPRAS.VER','DASHBOARD.VER'];
  const found=await tx.permiso.findMany({where:{codigo:{in:perms}},select:{id:true,codigo:true}});
  assert.deepEqual(found.map(p=>p.codigo).sort(),perms.slice().sort(),'Faltan permisos en pos_novnix');
  const role=await tx.rol.create({data:{codigo:`V4R_${marker.slice(-12)}`,nombre:'V4 rol aislado'}});ids.role=role.id;
  for(const p of found)await tx.rol_permiso.create({data:{rol_id:role.id,permiso_id:p.id}});
  const unit=await tx.unidad_medida.create({data:{codigo:`V4${marker.slice(-12)}`,nombre:'V4 Unidad'}});ids.unit=unit.id;
  async function company(suffix){const company=await tx.empresa.create({data:{razon_social:`${marker}_${suffix}`,nombre_comercial:`${marker}_${suffix}`,zona_horaria:'America/Mexico_City'}});ids.companies.push(company.id);return company;}
  const ca=await company('A'),cb=await company('B');
  async function branch(company,code){const b=await tx.sucursal.create({data:{empresa_id:company.id,codigo:`V4_${code}`,nombre:`V4 sucursal ${code}`}});ids.branches.push(b.id);return b;}
  const a1=await branch(ca,'A1'),a2=await branch(ca,'A2'),b1=await branch(cb,'B1');
  async function user(company,name,branches){const u=await tx.usuario.create({data:{empresa_id:company.id,username:`v4_${name}_${marker.slice(-8)}`,nombre:'Usuario V4',password_hash:'V4_TEST_ONLY_NO_LOGIN'}});ids.users.push(u.id);await tx.usuario_rol.create({data:{usuario_id:u.id,rol_id:role.id}});for(const b of branches)await tx.usuario_sucursal.create({data:{usuario_id:u.id,sucursal_id:b.id}});return u;}
  const limited=await user(ca,'limited',[a1]),wide=await user(ca,'wide',[a1,a2]),foreign=await user(cb,'foreign',[b1]);
  async function createProduct(company,name){const p=await tx.producto.create({data:{empresa_id:company.id,unidad_medida_id:unit.id,sku:`${marker}_${name}`,nombre:`Producto V4 ${name}`,controla_inventario:false,precio_venta:'10.00'}});ids.products.push(p.id);return p;}
  const prodA=await createProduct(ca,'A'),prodB=await createProduct(cb,'B');
  async function sale(company,branch,user,suffix){const warehouse=await tx.almacen.create({data:{sucursal_id:branch.id,codigo:'V4TEST',nombre:'V4 almacen'}});await tx.venta.create({data:{empresa_id:company.id,sucursal_id:branch.id,almacen_id:warehouse.id,usuario_id:user.id,folio:`${marker}_${suffix}`,estado:'BORRADOR',total:'0.00'}});}
  await sale(ca,a1,limited,'SALE_A1');await sale(ca,a2,wide,'SALE_A2');await sale(cb,b1,foreign,'SALE_B1');
  return {a1,a2,b1,limited,wide,foreign,prodA,prodB};
}
async function cleanup(prisma){
  if(!seeded)return;
  await prisma.$transaction(async tx=>{
    const owned=await tx.empresa.findMany({where:{id:{in:ids.companies}},select:{id:true,razon_social:true}});
    assert.equal(owned.length,2,'Limpieza detenida: faltan empresas sintéticas');
    assert.ok(owned.every(row=>row.razon_social.startsWith(marker+'_')),'Limpieza detenida: propiedad del fixture no demostrada');
    const companies=ids.companies;
    await tx.auditoria.deleteMany({where:{usuario_id:{in:ids.users}}});
    await tx.venta.deleteMany({where:{empresa_id:{in:companies}}});
    await tx.producto.deleteMany({where:{id:{in:ids.products}}});
    await tx.almacen.deleteMany({where:{sucursal_id:{in:ids.branches}}});
    await tx.usuario_sucursal.deleteMany({where:{usuario_id:{in:ids.users}}});
    await tx.usuario_rol.deleteMany({where:{usuario_id:{in:ids.users}}});
    await tx.usuario.deleteMany({where:{id:{in:ids.users}}});
    await tx.sucursal.deleteMany({where:{id:{in:ids.branches}}});
    await tx.empresa.deleteMany({where:{id:{in:companies}}});
    await tx.rol.delete({where:{id:ids.role}});
    await tx.unidad_medida.delete({where:{id:ids.unit}});
  },{timeout:30000});
  seeded=false;
  assert.equal(await prisma.empresa.count({where:{razon_social:{startsWith:marker}}}),0);
}
try {
  runtime=await localApp();
  const {prisma,tokenService,base}=runtime;
  const fixture=await prisma.$transaction(seed,{timeout:30000});seeded=true;
  const token=async u=>tokenService.createAccessToken({userId:u.id,empresaId:(await prisma.usuario.findUnique({where:{id:u.id},select:{empresa_id:true}})).empresa_id});
  const [a,aw,b]=await Promise.all([token(fixture.limited),token(fixture.wide),token(fixture.foreign)]);
  const from=dateInZone();
  const q=`?fecha_desde=${from}&fecha_hasta=${from}&limit=100`;
  async function expected(path,token,status){const res=await http(base,path,token);assert.equal(res.status,status,`${path} esperado=${status} obtenido=${res.status} body=${JSON.stringify(res.body).slice(0,250)}`);return res.body;}
  const limited=await expected(`/api/v1/reports/ventas${q}`,a,200);
  assert.equal(limited.data.pagination.total,1);
  assert.equal(limited.data.data[0].folio,`${marker}_SALE_A1`);
  const wide=await expected(`/api/v1/reports/ventas${q}`,aw,200);
  assert.equal(wide.data.pagination.total,2);
  const companyB=await expected(`/api/v1/reports/ventas${q}`,b,200);
  assert.equal(companyB.data.pagination.total,1);
  assert.equal(companyB.data.data[0].folio,`${marker}_SALE_B1`);
  for(const kind of ['ventas','devoluciones','compras','inventario','existencias','caja']){
    await expected(`/api/v1/reports/${kind}?sucursal_id=${fixture.a2.id}`,a,404);
    await expected(`/api/v1/reports/${kind}/export.csv?sucursal_id=${fixture.a2.id}`,a,404);
    await expected(`/api/v1/reports/${kind}?sucursal_id=${fixture.b1.id}`,a,404);
    await expected(`/api/v1/reports/${kind}?sucursal_id=${fixture.a1.id}`,b,404);
  }
  await expected(`/api/v1/dashboard/summary?sucursal_id=${fixture.a2.id}`,a,404);
  await expected(`/api/v1/products/${fixture.prodA.id}`,b,404);
  await expected(`/api/v1/products/${fixture.prodB.id}`,a,404);
  await expected(`/api/v1/products/${fixture.prodA.id}`,a,200);
  await expected(`/api/v1/dashboard/summary?sucursal_id=${fixture.a2.id}`,aw,200);
  const fakeToken=await tokenService.createAccessToken({userId:fixture.limited.id,empresaId:(await prisma.usuario.findUnique({where:{id:fixture.foreign.id},select:{empresa_id:true}})).empresa_id});
  await expected(`/api/v1/reports/ventas${q}`,fakeToken,401);
  console.log(JSON.stringify({status:'PASS',kind:'MULTIEMPRESA_MULTISUCURSAL_HTTP',marker,branches:3,companies:2,users:3,positive_and_denied_scenarios:true},null,2));
} catch(e){console.error('V4 TENANCY ERROR',e.stack||e);process.exitCode=1;}
finally{
  if(runtime){try{await cleanup(runtime.prisma);console.log('V4 TENANCY CLEANUP PASS');}catch(e){console.error('V4 TENANCY CLEANUP FAILED',marker,e);process.exitCode=1;}await runtime.close();}
}
