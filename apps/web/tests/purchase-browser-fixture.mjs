import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath,pathToFileURL } from 'node:url'
import { fixtureUser,createFixtureState } from './pos-fixture-state.mjs'
import { createPurchaseFixtureState } from './purchase-fixture-state.mjs'
export function purchaseUser(scenario) {
  const user=fixtureUser(scenario==='no-permission'?'no-permission':'normal')
  if (scenario!=='no-permission') ['COMPRAS.VER','PROVEEDORES.VER',...(scenario==='read-only'?[]:['COMPRAS.CREAR','COMPRAS.CANCELAR'])].forEach((codigo,index)=>user.permisos.push({id:String(200+index),codigo,modulo:codigo.split('.')[0],descripcion:null}))
  if (scenario==='no-suppliers') user.permisos=user.permisos.filter(item=>item.codigo!=='PROVEEDORES.VER')
  return user
}
export async function startPurchaseFixture(port=5182) {
  const state=createPurchaseFixtureState(),base=createFixtureState(),requests=[]
  const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),configFile:false,envDir:false,define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api/v1')},plugins:[react(),{
    name:'isolated-purchase-fixture',
    transformIndexHtml(html,context) {
      const scenario=new URL(context.originalUrl||'/','http://fixture').searchParams.get('fixture')||'normal'
      const auth={accessToken:'fixture-'+scenario,user:purchaseUser(scenario),expiresAt:Date.now()+3600000}
      return [{tag:'script',injectTo:'head-prepend',children:'sessionStorage.setItem("posmycleth.auth.session.v1",'+JSON.stringify(JSON.stringify(auth))+')'}]
    },
    configureServer(vite) {vite.middlewares.use(async(req,res,next)=>{
      const url=new URL(req.url||'/','http://fixture')
      if (req.method==='GET'&&url.pathname==='/__qa/purchases') {res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({...state.summary(),http:requests}));return}
      if (!url.pathname.startsWith('/api/')) return next()
      const scenario=String(req.headers.authorization||'').replace('Bearer fixture-','')||'normal'
      try {
        const chunks=[];for await (const chunk of req) chunks.push(chunk)
        const input=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null
        const result=url.pathname==='/api/v1/auth/me'?{status:200,body:{ok:true,data:purchaseUser(scenario)}}:state.handle(req.method,url,scenario,input,req.headers['idempotency-key'])??base.handle(req.method,url,scenario==='cash-other'?'cash-other':'normal',input)
        requests.push({method:req.method,path:url.pathname,scenario,status:result.status})
        if (result.delay) await new Promise(resolve=>setTimeout(resolve,result.delay))
        res.writeHead(result.status,{'Content-Type':'application/json'});res.end(JSON.stringify(result.body))
      } catch {res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,message:'Solicitud simulada no válida.'}))}
    })},
  }],server:{host:'127.0.0.1',port,strictPort:true}})
  await server.listen()
  return {server,url:'http://127.0.0.1:'+server.httpServer.address().port,stats:()=>state.summary()}
}
if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const fixture=await startPurchaseFixture(Number(process.env.PURCHASE_FIXTURE_PORT||5182))
  process.stdout.write('Compras y proveedores aislados: '+fixture.url+'/purchases\n')
  process.stdin.setEncoding('utf8');process.stdin.on('data',async text=>{if(text.trim()==='stop'){await fixture.server.close();process.exit(0)}if(text.trim()==='stats')process.stdout.write(JSON.stringify(fixture.stats())+'\n')})
}
