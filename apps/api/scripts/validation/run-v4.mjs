/**
 * POSMYCLETH v4 final acceptance in the LOCAL TEST environment.
 * Executes v3 --full unchanged, then 5 additional scenario gates.
 * Never runs migrations, backups, git commits, E-commerce production, or blanket cleanup.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';
import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream,existsSync} from 'node:fs';
import {mkdir,writeFile,readdir,readFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const API=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const mode=process.argv[2]??'--help';
if(mode==='--help'){console.log('Uso: node.exe scripts/validation/run-v4.mjs --full | --preflight');process.exit(0);}
assert.ok(['--full','--preflight'].includes(mode)&&process.argv.length<=3,'Modo invalido');
const rawUrl=process.env.DATABASE_URL;
assert.ok(rawUrl,'DATABASE_URL requerida');
const u=new URL(rawUrl);
assert.ok(['postgres:','postgresql:'].includes(u.protocol));
assert.ok(['127.0.0.1','localhost'].includes(u.hostname));
assert.ok(!u.port||u.port==='5432');
assert.equal(decodeURIComponent(u.pathname),'/pos_novnix');
assert.ok(!u.searchParams.has('host')&&(!u.searchParams.has('schema')||u.searchParams.get('schema')==='pos'));
assert.notEqual(process.env.NODE_ENV,'production');
assert.equal(execFileSync('git',['branch','--show-current'],{cwd:API,encoding:'utf8'}).trim(),'devalex');
assert.equal(process.env.INVENTORY_SYNC_ENABLED,'false');
const base=join(API,'docs','validation-integral','results');
const required=['scripts/validation/run-integral.mjs','tests/integral/v4-safety.mjs','tests/integral/v4-tenancy-http.mjs','tests/integral/v4-end-to-end.mjs','tests/integral/v4-ecommerce-mock.mjs','tests/integral/v4-load.mjs'];
for(const path of required)assert.ok(existsSync(join(API,path)),`Falta ${path}`);
if(mode==='--preflight'){
  console.log('V4 PRECHECK: rama, DB local, archivos y sync desactivada = PASS');
  console.log('NO se ejecutaron consultas ni modificaciones PostgreSQL.');
  process.exit(0);
}
assert.equal(process.env.POS_INTEGRAL_ALLOW_WRITES,'SI','Confirmación explícita de pruebas que escriben temporalmente requerida');
assert.equal(process.env.POS_INTEGRAL_WORKERS_STOPPED,'SI','Confirma servidores externos y workers detenidos');
const env={...process.env,NODE_ENV:'test',POS_ALLOW_TEST_DB:'SI',INVENTORY_SYNC_ENABLED:'false'};
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:API,encoding:'utf8'}).trim();
const out=join(base,`final-v4-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
await mkdir(out,{recursive:true});
const started=new Date().toISOString(),results=[],notes=[];
const pgClient=new pg.Client({connectionString:rawUrl,connectionTimeoutMillis:5000,query_timeout:30000});
const TABLES=['almacen','auditoria','caja','categoria','cliente','cliente_direccion','compra','compra_detalle','compra_pago','configuracion_empresa','cotizacion','cotizacion_detalle','empresa','existencia','impuesto','metodo_pago','movimiento_caja','movimiento_inventario','sincronizacion_ecommerce_inventario','orden_venta','orden_venta_detalle','pedido_cliente','pedido_cliente_detalle','permiso','producto','producto_impuesto','proveedor','proveedor_direccion','rol','rol_permiso','sesion_caja','sucursal','transferencia_almacen','transferencia_detalle','unidad_medida','usuario','operacion_transferencia','usuario_rol','usuario_sucursal','venta','venta_detalle','venta_pago','devolucion_pago','devolucion_venta','devolucion_venta_detalle','ajuste_inventario','operacion_compra'];
function redact(s){return String(s).replaceAll(rawUrl,'[DATABASE_URL]').replace(/postgres(?:ql)?:\/\/[^\s\"']+/gi,'[DATABASE_URL]').replace(/Bearer\s+[^\s\"']+/g,'Bearer [REDACTED]');}
function item(name,status,detail,log=''){results.push({name,status,detail,log});console.log(`[${status}] ${name} — ${detail}`);}
async function snapshot(){
  const result={};
  await pgClient.query('BEGIN');
  await pgClient.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  try{for(const t of TABLES){const r=await pgClient.query(`SELECT COUNT(*)::int AS n, md5(COALESCE(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'') ) AS fingerprint FROM pos.${t} AS t`);result[t]=r.rows[0];}}
  finally{await pgClient.query('ROLLBACK');}
  return result;
}
function changed(before,after){return TABLES.filter(t=>JSON.stringify(before[t])!==JSON.stringify(after[t]));}
async function processRun(name,args,timeoutMs){
  const file=`${String(results.length+1).padStart(2,'0')}-${name.replace(/[^a-z0-9]+/gi,'-')}.log`;
  const writer=createWriteStream(join(out,file),{flags:'wx'});
  let output='',expired=false;
  const start=Date.now();
  const ret=await new Promise(resolveResult=>{
    const ch=spawn(process.execPath,args,{cwd:API,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
    const read=b=>{const s=redact(b.toString());writer.write(s);output=(output+s).slice(-20000);};
    ch.stdout.on('data',read);ch.stderr.on('data',read);
    const timer=setTimeout(()=>{expired=true;ch.kill();},timeoutMs);
    ch.once('error',e=>{clearTimeout(timer);resolveResult({code:-1,error:e.message});});
    ch.once('close',(code,signal)=>{clearTimeout(timer);resolveResult({code,signal});});
  });
  await new Promise(resolveEnd=>writer.end(resolveEnd));
  return {ok:ret.code===0&&!expired,detail:`exit=${ret.code},signal=${ret.signal??'none'},elapsed_ms=${Date.now()-start}${expired?',TIMEOUT':''}`,file,tail:output};
}
async function execute(name,file,baselineSnapshot,timeout=240000){
  const r=await processRun(name,['--import','tsx',file],timeout);
  const after=await snapshot();
  const dirty=changed(baselineSnapshot,after);
  item(name,r.ok&&!dirty.length?'PASS':'FAIL',`${r.detail}; ${dirty.length?`TABLAS MODIFICADAS ${dirty.join(', ')}`:'47 tablas con huellas restauradas'}`,r.file);
  if(!r.ok)console.error(r.tail.slice(-3500));
  return r.ok&&!dirty.length;
}
let v3={status:'NOT_RUN',counts:null,report:null};
try{
  await pgClient.connect();
  const verified=await pgClient.query("SELECT current_database() AS database,inet_server_port() AS port,exists(SELECT 1 FROM pg_namespace WHERE nspname='pos') AS schema_ok");
  assert.equal(verified.rows[0]?.database,'pos_novnix');assert.equal(verified.rows[0]?.port,5432);assert.equal(verified.rows[0]?.schema_ok,true);
  // Bloquear ejecuciones nuevas mientras existan fixtures V4 no recuperados.
  const leftovers=await pgClient.query("SELECT razon_social FROM pos.empresa WHERE razon_social LIKE 'V4_E2E_%' OR razon_social LIKE 'V4_TENANT_%' LIMIT 10");
  assert.equal(leftovers.rows.length,0,`Fixtures V4 residuales: ${leftovers.rows.map(r=>r.razon_social).join(', ')}. Inspeccionar/recuperar antes de repetir.`);
  const before=await snapshot();
  console.log('POSMYCLETH V4 | preflight=PASS | 47 tablas | HEAD',head.slice(0,8));
  console.log('Informe final:',out);
  const v3R=await processRun('Regresion-integral-v3',['scripts/validation/run-integral.mjs','--full'],600000);
  const match=v3R.tail.match(/FINAL:\s*PASS=(\d+)\s*FAIL=(\d+)\s*SKIP=(\d+)/);
  const finalNums=match?{PASS:Number(match[1]),FAIL:Number(match[2]),SKIP:Number(match[3])}:null;
  const afterBase=await snapshot();const diff=changed(before,afterBase);
  v3={status:v3R.ok&&finalNums?.FAIL===0&&finalNums.PASS>=100&&finalNums.SKIP===5&&!diff.length?'PASS':'FAIL',counts:finalNums,report:null};
  item('Regresión integral v3',v3.status,JSON.stringify({counts:finalNums,dirty_tables:diff,process:v3R.detail}),v3R.file);
  if(!v3R.ok)console.error(v3R.tail.slice(-3500));
  if(v3.status==='PASS'){
    const todo=[
      ['Multiempresa HTTP: aislamiento positivo/negativo','tests/integral/v4-tenancy-http.mjs'],
      ['Multisucursal HTTP: acceso parcial en JSON/CSV','tests/integral/v4-tenancy-http.mjs'],
      ['Flujo E2E: compra-recepción-transferencia-venta-devolución','tests/integral/v4-end-to-end.mjs'],
      ['Contrato Ecommerce con mock HTTP independiente','tests/integral/v4-ecommerce-mock.mjs'],
      ['Carga HTTP 500 solicitudes y SLO provisional','tests/integral/v4-load.mjs']
    ];
    // The same tenancy run covers two separate goals; execute once, record both.
    const runOnce=await execute('Multiempresa/multisucursal HTTP',todo[0][1],before);
    item(todo[0][0],runOnce?'PASS':'FAIL',runOnce?'2 empresas, 3 sucursales, usuarios con alcance parcial comprobados':'Fallo en fixture multiempresa, revisar log');
    item(todo[1][0],runOnce?'PASS':'FAIL',runOnce?'Rutas JSON/CSV y límites sucursales bajo mismo fixture':'Fallo en fixture multisucursal, revisar log');
    if(runOnce){
      for(const [name,file] of todo.slice(2)){
        const ok=await execute(name,file,before, name.includes('Carga')?300000:240000);
        if(!ok){notes.push('Se detuvieron las pruebas siguientes por fallo o datos residuales.');break;}
      }
    }
  }
} catch(e){item('Ejecución v4','FAIL',redact(e.stack||e.message));}
finally{
  await pgClient.end().catch(()=>{});
  const required=['Multiempresa HTTP: aislamiento positivo/negativo','Multisucursal HTTP: acceso parcial en JSON/CSV','Flujo E2E: compra-recepción-transferencia-venta-devolución','Contrato Ecommerce con mock HTTP independiente','Carga HTTP 500 solicitudes y SLO provisional'];
  const accepted=v3.status==='PASS'&&required.every(n=>results.some(r=>r.name===n&&r.status==='PASS'))&&results.every(r=>r.status==='PASS');
  const counts=Object.fromEntries(['PASS','FAIL','SKIP'].map(status=>[status,results.filter(x=>x.status===status).length]));
  const skipped=required.filter(n=>!results.some(r=>r.name===n));
  for(const name of skipped){item(name,'SKIP','Bloqueada por fallo o interrupción anterior');counts.SKIP++;}
  const finalStatus=accepted?'ACEPTACION_FUNCIONAL_ENTORNO_PRUEBAS':'RECHAZADA_O_INCOMPLETA';
  const limits=[
    'Ecommerce: se verifica un mock HTTP local, NO una integración con servicio real externo/staging.',
    'Carga: umbrales SLO provisionales y base pequeña; NO establece SLA de producción.',
    'Fixture E2E comprueba un flujo secuencial real; no certifica atomicidad de múltiples transacciones como una sola operación.',
    'Las secuencias PostgreSQL pueden avanzar con los fixtures aunque las tablas queden restauradas.',
    'Revisar cambios locales de los parches v2/v3 antes de hacer commit; este script no realiza commits ni migraciones.'
  ];
  const summary={project:'POSMYCLETH',version:'v4',started,finished:new Date().toISOString(),branch:'devalex',head,database:'pos_novnix',v3,counts,status:finalStatus,production_approved:false,limitations:limits,notes,results};
  await writeFile(join(out,'acceptance.json'),JSON.stringify(summary,null,2)+'\n');
  const md=['# POSMYCLETH — Informe final de aceptación v4','',`- HEAD: \`${head}\``,`- Base: pos_novnix / pos`,`- Regresión v3: ${v3.status} (${JSON.stringify(v3.counts)})`,`- v4: PASS ${counts.PASS}, FAIL ${counts.FAIL}, SKIP ${counts.SKIP}`,`- **Resultado funcional: ${finalStatus}**`,'- **Autorización para producción: NO determinada por esta suite**','', '| Escenario | Estado | Evidencia |','|---|---|---|',...results.map(r=>`| ${r.name.replaceAll('|','/')} | ${r.status} | ${(r.log?`\`${r.log}\`; `:'')+r.detail.replaceAll('|','/')} |`),'','## Limitaciones (no se ocultan)',...limits.map(x=>`- ${x}`),'','## Decisión de aceptación','',accepted?'Apto para continuar hacia preproducción con las limitaciones enumeradas; NO equivale a aprobación de despliegue público.':'No aceptado todavía. Resolver FAIL y SKIP y repetir la corrida integral.','','## Preservación de datos','', 'La suite verifica huellas de 47 tablas antes y después de cada escenario. Si la limpieza falla, conserva marcadores de fixtures en logs para revisión manual. No elimina datos ajenos automáticamente.'];
  await writeFile(join(out,'acceptance.md'),md.join('\n')+'\n');
  console.log(`\nFINAL V4: ${finalStatus} | PASS=${counts.PASS} FAIL=${counts.FAIL} SKIP=${counts.SKIP}`);
  console.log('Informe:',out);
  if(!accepted)process.exitCode=1;
}
