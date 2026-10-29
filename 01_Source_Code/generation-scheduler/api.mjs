import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {store,pool,redis,enabled,number,close} from './runtime.mjs';
import {businessApi} from './business-api.mjs';

const token=process.env.SCHEDULER_TOKEN;
if(!token||token.length<40)throw Error('Strong SCHEDULER_TOKEN required');
const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
const view=job=>({id:job.id,requestId:job.request_id,status:job.status,createdAt:job.created_at,updatedAt:job.updated_at,errorCode:job.error_code,resultReady:job.status==='SUCCEEDED'});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const server=createServer(async(req,res)=>{
 try{
  if(req.url==='/healthz'&&req.method==='GET'){
   await pool.query('SELECT 1');await redis.ping();return send(res,200,{ok:true,providerEnabled:enabled,mode:'business-scheduler',limits:{remoteRunning:number('PROVIDER_MAX_RUNNING',15),submitConcurrency:number('PROVIDER_SUBMIT_CONCURRENCY',2),submitIntervalMs:number('PROVIDER_SUBMIT_INTERVAL_MS',500),images:1}});
  }
  const supplied=Buffer.from(String(req.headers.authorization||'')),expected=Buffer.from('Bearer '+token);
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(res,401,{error:'unauthorized'});
  const user=req.headers['x-user-id'];
  if(typeof user!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(user))return send(res,400,{error:'trusted_user_id_required'});
  if(await businessApi(req,res,{store,user,directory:process.env.RESULT_DIRECTORY,enabled,send}))return;
  if(req.url==='/v1/jobs'&&req.method==='POST'){
   if(!enabled)return send(res,503,{error:'provider_activation_pending'});
   const key=req.headers['idempotency-key'];if(!uuid.test(key||''))return send(res,400,{error:'uuid_idempotency_key_required'});
   req.setEncoding('utf8');let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>262144)return send(res,413,{error:'payload_too_large'});}
   let params;try{params=JSON.parse(text);}catch{return send(res,400,{error:'invalid_json'});}
   if(!params||typeof params!=='object'||Array.isArray(params)||typeof params.prompt!=='string'||!params.prompt.trim()||params.prompt.length>20000||!['gpt-image-2','gpt-image-2.5-flare','flux-3-image'].includes(params.model)||params.n!==1)return send(res,400,{error:'single_image_request_required'});
   return send(res,202,view(await store.create(user,key,params)));
  }
  if(req.url==='/v1/jobs'&&req.method==='GET')return send(res,200,{jobs:(await store.list(user)).map(view)});
  const match=/^\/v1\/jobs\/([0-9a-f-]{36})(\/cancel)?$/.exec(req.url);
  if(match&&uuid.test(match[1])){
   const job=match[2]&&req.method==='POST'?await store.cancel(user,match[1]):req.method==='GET'&&!match[2]?await store.get(user,match[1]):null;
   return send(res,job?200:404,job?view(job):{error:'not_found_or_not_cancellable'});
  }
  send(res,404,{error:'not_found'});
 }catch(error){send(res,error.status||503,{error:error.status?error.message:'service_unavailable'});}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(number('PORT',3320,1024,65535),'127.0.0.1',()=>console.log('scheduler_api_ready'));
process.on('SIGTERM',()=>server.close(()=>{void close();}));
