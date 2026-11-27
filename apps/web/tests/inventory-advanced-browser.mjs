import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath,pathToFileURL } from 'node:url'
import { fixtureUser,createFixtureState } from './pos-fixture-state.mjs'
import { createInventoryFixture } from './inventory-advanced-fixture.mjs'
function inventoryUser(scenario){const user=fixtureUser(scenario==='no-permission'?'no-permission':'normal');if(!['read-only','no-permission'].includes(scenario))['INVENTARIO.AJUSTAR','INVENTARIO.TRANSFERIR'].forEach((codigo,index)=>user.permisos.push({id:String(300+index),codigo,modulo:'INVENTARIO',descripcion:null}));return user}
export async function startInventoryFixture(port=5183){
  const state=createInventoryFixture(),base=createFixtureState(),http=[]
  const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),configFile:false,envDir:false,define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api/v1')},plugins:[react(),{
    name:'isolated-advanced-inventory',
    transformIndexHtml(html,context){const scenario=new URL(context.originalUrl||'/','http://fixture').searchParams.get('fixture')||'normal',auth={accessToken:'fixture-'+scenario,user:inventoryUser(scenario),expiresAt:Date.now()+3600000};return[{tag:'script',injectTo:'head-prepend',children:'sessionStorage.setItem("posmycleth.auth.session.v1",'+JSON.stringify(JSON.stringify(auth))+')'}]},
    configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
      const url=new URL(req.url||'/','http://fixture')
      if(req.method==='GET'&&url.pathname==='/__qa/inventory'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({...state.summary(),http}));return}
      if(!url.pathname.startsWith('/api/'))return next()
      const scenario=String(req.headers.authorization||'').replace('Bearer fixture-','')||'normal'
      try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const input=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null
        const result=url.pathname==='/api/v1/auth/me'?{status:200,body:{ok:true,data:inventoryUser(scenario)}}:state.handle(req.method,url,scenario,input,req.headers['idempotency-key'])??base.handle(req.method,url,'normal',input)
        http.push({method:req.method,path:url.pathname,scenario,status:result.status})
        res.writeHead(result.status,{'Content-Type':'application/json'});res.end(JSON.stringify(result.body))
      }catch{res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,message:'Solicitud aislada no válida.'}))}
    })},
  }],server:{host:'127.0.0.1',port,strictPort:true}})
  await server.listen();return{server,url:'http://127.0.0.1:'+server.httpServer.address().port,stats:()=>state.summary()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const fixture=await startInventoryFixture(Number(process.env.INVENTORY_FIXTURE_PORT||5183));process.stdout.write('Inventario avanzado aislado: '+fixture.url+'/inventory\n');process.stdin.setEncoding('utf8');process.stdin.on('data',async text=>{if(text.trim()==='stop'){await fixture.server.close();process.exit(0)}if(text.trim()==='stats')process.stdout.write(JSON.stringify(fixture.stats())+'\n')})}
