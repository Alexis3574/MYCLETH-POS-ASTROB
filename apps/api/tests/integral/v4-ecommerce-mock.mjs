/** Transport contract against isolated HTTP mock; NEVER contacts Ecommerce production. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { guard } from './v4-safety.mjs';
guard();
const received=[];
let mode='ok';
const server=createServer(async (req,res)=>{
  const chunks=[];
  for await(const chunk of req) chunks.push(chunk);
  const raw=Buffer.concat(chunks).toString('utf8');
  received.push({method:req.method,url:req.url,apiKey:req.headers['x-api-key'],raw});
  if(mode==='timeout'){await new Promise(resolve=>setTimeout(resolve,1500));res.writeHead(200,{'content-type':'application/json'});res.end('{}');return;}
  if(mode==='rate'){res.writeHead(429,{'content-type':'application/json','retry-after':'1'});res.end(JSON.stringify({error:'rate limited'}));return;}
  if(mode==='failure'){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'upstream unavailable'}));return;}
  if(mode==='text'){res.writeHead(502,{'content-type':'text/plain'});res.end('gateway failure');return;}
  res.writeHead(200,{'content-type':'application/json','x-idempotent-replay':mode==='replay'?'true':'false'});
  res.end(JSON.stringify({success:true,data:{operation_id:'v4-local',product_id:77,previous_quantity:10,adjustment:-2,inventory:{quantity:8}}}));
});
try {
  server.listen(0,'127.0.0.1');await once(server,'listening');
  process.env.ECOMMERCE_API_URL=`http://127.0.0.1:${server.address().port}`;
  process.env.ECOMMERCE_API_KEY='V4_TEST_KEY_ONLY';
  process.env.ECOMMERCE_API_TIMEOUT_MS='250';
  const {ecommerceRequestWithMeta,EcommerceApiError}=await import('../../src/integrations/ecommerce/ecommerce.client.ts');
  const {adjustEcommerceInventory}=await import('../../src/integrations/ecommerce/inventory.client.ts');
  const input={productId:77,operationId:'V4_IDEMPOTENCE',adjustment:-2};
  const initial=await adjustEcommerceInventory(input);
  assert.equal(initial.status,200);
  assert.equal(initial.idempotentReplay,false);
  assert.equal(received.at(-1).method,'PATCH');
  assert.equal(received.at(-1).url,'/products/77/inventory');
  assert.equal(received.at(-1).apiKey,'V4_TEST_KEY_ONLY');
  assert.deepEqual(JSON.parse(received.at(-1).raw),{operation_id:input.operationId,adjustment:-2});
  mode='replay';const replay=await adjustEcommerceInventory(input);
  assert.equal(replay.idempotentReplay,true);
  assert.equal(JSON.parse(received.at(-1).raw).operation_id,input.operationId);
  for(const [statusMode,status] of [['rate',429],['failure',503],['text',502]]){
    mode=statusMode;
    await assert.rejects(()=>ecommerceRequestWithMeta('/products/77/inventory',{method:'PATCH',body:{operation_id:input.operationId,adjustment:-2}}),e=>e instanceof EcommerceApiError&&e.status===status);
  }
  mode='timeout';
  await assert.rejects(()=>adjustEcommerceInventory(input),e=>e?.name==='TimeoutError'||e?.name==='AbortError');
  console.log(JSON.stringify({status:'PASS',kind:'ECOMMERCE_HTTP_CONTRACT_LOCAL_MOCK',cases:['PATCH','apiKey','payload','replay','429','503','502','timeout'],calls:received.length,scope:'mock-local; staging externo NO verificado'},null,2));
} finally {
  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
}
