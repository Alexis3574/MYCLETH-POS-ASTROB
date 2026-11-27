import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath,pathToFileURL } from 'node:url'
import { fixtureUser,createFixtureState } from './pos-fixture-state.mjs'
import { createPurchaseFixtureState } from './purchase-fixture-state.mjs'
import { createInventoryFixture,inventoryProduct } from './inventory-advanced-fixture.mjs'
import { createWorkflowFixture, workflowViewCodes, workflowWriteCodes } from './workflows-fixture.mjs'

export function commercialUser(scenario='normal'){
  const user=fixtureUser(scenario==='no-permission'?'no-permission':'normal')
  if(scenario==='read-only')user.permisos=user.permisos.filter(item=>!['VENTAS.CREAR','VENTAS.DEVOLVER','VENTAS.CANCELAR'].includes(item.codigo))
  if(scenario!=='no-permission'){
    const codes=['COMPRAS.VER','PROVEEDORES.VER',...workflowViewCodes,...(scenario==='read-only'?[]:['COMPRAS.CREAR','COMPRAS.CANCELAR','INVENTARIO.AJUSTAR','INVENTARIO.TRANSFERIR',...workflowWriteCodes])]
    codes.forEach((codigo,index)=>user.permisos.push({id:String(400+index),codigo,modulo:codigo.split('.')[0],descripcion:null}))
  }
  if(scenario!=='no-permission')user.roles=[{id:'1',codigo:'ADMIN-QA',nombre:'Administrador simulado'}]
  return user
}
const failure=(status,message)=>({status,body:{ok:false,message}})
export function createCommercialFixture(){
  const inventory=createInventoryFixture(),purchases=createPurchaseFixtureState(inventory),bases=new Map(),http=[],workflows=createWorkflowFixture(getBase)
  function getBase(scenario){
    if(!bases.has(scenario))bases.set(scenario,createFixtureState({available:(productId,warehouse)=>inventory.saleAvailable(scenario,productId,warehouse),applySale:(sale,kind,details,id)=>inventory.applySale(scenario,sale,kind,details,id)}))
    return bases.get(scenario)
  }
  function handle(method,url,scenario='normal',input=null,key=null){
    const path=url.pathname.replace(/^\/api\/v1/,'')
    let result
    if(path==='/auth/me'&&method==='GET')result={status:200,body:{ok:true,data:commercialUser(scenario)}}
    else if(scenario==='no-permission'||scenario==='read-only'&&method!=='GET')result=failure(403,'Sin permiso para esta operación simulada.')
    else{
      result=workflows.handle(method,url,scenario,input)??purchases.handle(method,url,scenario,input,key)??inventory.handle(method,url,scenario,input,key)
      if(!result&&method==='GET'&&path==='/products'){
        // Catálogo de compra acotado a los productos admitidos por su oráculo.
        const allUrl=new URL(url);allUrl.searchParams.set('page','1');allUrl.searchParams.set('limit','1000')
        const response=getBase(scenario).handle('GET',allUrl,'normal'),rows=response.body.data.filter(row=>[inventoryProduct.id,'40'].includes(row.id)),page=Number(url.searchParams.get('page')||1),limit=Number(url.searchParams.get('limit')||20)
        result={status:200,body:{ok:true,data:rows.slice((page-1)*limit,page*limit),pagination:{page,limit,total:rows.length,total_pages:Math.ceil(rows.length/limit)}}}
      }
      if(!result&&(path.startsWith('/sales/')||path==='/sales'||method==='GET'&&(path==='/customers'||path==='/payment-methods'||/^\/cash(?:\/\d+\/sessions\/current)?$/.test(path))))result=getBase(scenario).handle(method,url,scenario,input)
      result??=failure(404,'Ruta fuera del alcance de la prueba conjunta.')
    }
    http.push({method,path,scenario,status:result.status})
    return result
  }
  return{handle,summary:()=>{const purchaseSnapshot=purchases.summary();return{inventory:inventory.summary(),purchases:purchaseSnapshot,sales:[...bases].map(([name,state])=>({name,...state.summary()})),workflows:workflows.summary(),http}}}
}

export async function startCommercialFixture(port=5184){
  const state=createCommercialFixture()
  const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),configFile:false,envDir:false,define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api/v1')},plugins:[react(),{
    name:'isolated-integrated-commercial',
    transformIndexHtml(_html,context){
      const scenario=new URL(context.originalUrl||'/','http://fixture').searchParams.get('fixture')||'normal',auth={accessToken:'fixture-'+scenario,user:commercialUser(scenario),expiresAt:Date.now()+3600000}
      return[{tag:'script',injectTo:'head-prepend',children:'sessionStorage.setItem("posmycleth.auth.session.v1",'+JSON.stringify(JSON.stringify(auth))+')'},
        {tag:'aside',attrs:{'aria-label':'Entorno de simulación conjunta',style:'background:#fff4d6;color:#633d08;padding:10px 18px;font:14px/1.5 system-ui;border-bottom:1px solid #e5c777;'},injectTo:'body-prepend',children:'Simulación conjunta · Operación comercial, cotizaciones, pedidos, crédito y administración · Datos en memoria · Sin PostgreSQL real'}]
    },
    configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
      const url=new URL(req.url||'/','http://fixture')
      if(req.method==='GET'&&url.pathname==='/__qa/commercial'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(state.summary()));return}
      if(!url.pathname.startsWith('/api/'))return next()
      const scenario=String(req.headers.authorization||'').replace('Bearer fixture-','')||'normal'
      try{
        const chunks=[];let size=0
        for await(const chunk of req){size+=chunk.length;if(size>1048576)throw new Error('Solicitud demasiado grande.');chunks.push(chunk)}
        const input=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null,result=state.handle(req.method,url,scenario,input,req.headers['idempotency-key'])
        if(result.delay)await new Promise(resolve=>setTimeout(resolve,result.delay))
        res.writeHead(result.status,{'Content-Type':'application/json'});res.end(JSON.stringify(result.body))
      }catch{res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,message:'Solicitud simulada no válida.'}))}
    })},
  }],server:{host:'127.0.0.1',port,strictPort:true}})
  await server.listen();return{server,url:'http://127.0.0.1:'+server.httpServer.address().port,stats:()=>state.summary()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const fixture=await startCommercialFixture(Number(process.env.COMMERCIAL_FIXTURE_PORT||5184))
  process.stdout.write('POS + Ventas + Clientes + Compras + Inventario, simulación conjunta: '+fixture.url+'/pos\n')
  process.stdin.setEncoding('utf8');process.stdin.on('data',async value=>{if(value.trim()==='stop'){await fixture.server.close();process.exit(0)}if(value.trim()==='stats')process.stdout.write(JSON.stringify(fixture.stats())+'\n')})
}
