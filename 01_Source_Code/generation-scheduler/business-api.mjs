import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,rename,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hasDiskSpace} from './capacity.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
async function body(req,limit){
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>limit)fail(413,'payload_too_large');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'invalid_json');}
}
export async function businessApi(req,res,{store,user,directory,enabled,send}){
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/v1/active-batches'&&req.method==='GET'){
  const after=url.searchParams.get('after');if(after&&!uuid.test(after))fail(400,'invalid_cursor');
  send(res,200,{batches:await store.activeBatches(after)});return true;
 }
 const latest=/^\/v1\/tasks\/([-a-zA-Z0-9_]{1,80})\/batch$/.exec(url.pathname);
 if(latest&&req.method==='GET'){send(res,200,await store.latestBatch(user,latest[1]));return true;}
 if(req.url==='/v1/batches'&&req.method==='POST'){
  const {id,descriptor}=await body(req,262144);
  if(!uuid.test(id||'')||descriptor?.generation?.id!==id||!/^[-a-zA-Z0-9_]{1,80}$/.test(descriptor?.taskId||'')||!Array.isArray(descriptor.items)||!descriptor.items.length||descriptor.items.length>200||descriptor.items.some(item=>typeof item.key!=='string'||!item.key||item.key.length>200)||new Set(descriptor.items.map(item=>item.key)).size!==descriptor.items.length)fail(400,'invalid_business_batch');
  await store.beginBatch(user,id,descriptor);send(res,201,{id});return true;
 }
 const match=/^\/v1\/batches\/([0-9a-f-]{36})(?:\/(commit|ack|abort|jobs)(?:\/([0-9a-f-]{36}))?)?$/.exec(req.url);
 if(match&&uuid.test(match[1])){
  const [,,action,requestId]=match,id=match[1],batch=await store.batch(user,id);
  if(!batch)fail(404,'batch_not_found');
  if(action==='jobs'&&req.method==='PUT'&&uuid.test(requestId||'')){
   if(!await hasDiskSpace(directory,2))fail(507,'disk_reserve_required');
   const {key,plan,imageRefs,resumeJobId,resumeTask}=await body(req,64*1024*1024);
   if(!batch.descriptor.items.some(item=>item.key===key)||!plan||plan.request?.n!==1||(!['gpt-image-2','gpt-image-2.5-flare','flux-3-image'].includes(plan.request.model)&&!(plan.local===true&&plan.request.model==='local'))||typeof plan.request.prompt!=='string'||!plan.request.prompt.trim())fail(400,'invalid_image_plan');
   for(const [field,index] of Object.entries(imageRefs||{})){
    if(!['baseImage','placementGuide','maskImage','foilMaskImage','goldMaskImage'].includes(field)||plan[field]!==null||!Number.isInteger(index)||index<0||typeof plan.request.image_urls?.[index]!=='string')fail(400,'invalid_image_reference');
    plan[field]=plan.request.image_urls[index];
   }
   const serialized=JSON.stringify(plan),hash=createHash('sha256').update(serialized).digest('hex');
   const folder=join(directory,'plans');await mkdir(folder,{recursive:true,mode:0o700});
   const path=join(folder,hash+'.json'),temporary=path+'.'+randomUUID();
   try{
    const file=await open(temporary,'wx',0o600);try{await file.writeFile(serialized);await file.sync();}finally{await file.close();}
    await rename(temporary,path);
    if(process.platform!=='win32'){const parent=await open(folder,'r');try{await parent.sync();}finally{await parent.close();}}
   }finally{await rm(temporary,{force:true});}
   const previous=uuid.test(resumeJobId||'')?await store.get(user,resumeJobId):null;
   const resume=previous&&previous.params.planHash===hash&&['DOWNLOAD_FAILED','PROCESS_FAILED'].includes(previous.status)?{resumeJobId}:{};
   if(resumeTask){
    if(resumeTask.imageUrl){const url=new URL(resumeTask.imageUrl);if(url.protocol!=='https:'||!['apimart.ai','getapib.org'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))fail(400,'untrusted_image_host');}
    if(!resumeTask.imageUrl&&(typeof resumeTask.taskId!=='string'||!resumeTask.taskId||resumeTask.taskId.length>200))fail(400,'invalid_provider_task');
    resume.resumeTask=resumeTask;
   }
   const job=await store.create(user,requestId,{batchId:id,key,planHash:hash,...(plan.local?{local:true}:{}),...resume});send(res,202,{id:job.id,status:job.status});return true;
  }
  if(action==='commit'&&req.method==='POST'){send(res,200,await store.commitBatch(user,id));return true;}
  if(action==='ack'&&req.method==='POST'){await store.acknowledgeBatch(user,id);send(res,200,{ok:true});return true;}
  if(action==='abort'&&req.method==='POST'){await store.abortBatch(user,id);send(res,200,{ok:true});return true;}
  if(!action&&req.method==='GET'){
   const jobs=await Promise.all(batch.jobs.map(async job=>{
    let storage;if(job.status==='SUCCEEDED'){try{storage=JSON.parse(await readFile(join(directory,job.id+'.storage.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}}
    return {id:job.id,key:job.params.key,status:job.status,errorCode:job.error_code,providerTaskId:job.provider_task_id,local:!!job.params.local,localResult:job.error_code==='storage_pending',...(storage?{storage}:{})};
   }));
   send(res,200,{id,userId:user,createdAt:batch.created_at,descriptor:batch.descriptor,status:batch.status,providerEnabled:enabled,jobs});return true;
  }
 }
 const result=/^\/v1\/jobs\/([0-9a-f-]{36})\/result$/.exec(req.url);
 if(result&&uuid.test(result[1])&&req.method==='GET'){
  const job=await store.get(user,result[1]);if(!job||(job.status!=='SUCCEEDED'&&job.error_code!=='storage_pending'))fail(404,'result_not_ready');
  const bytes=await readFile(join(directory,job.id+(job.params.batchId?'.png':'.webp')));
  res.writeHead(200,{'Content-Type':job.params.batchId?'image/png':'image/webp','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);return true;
 }
 return false;
}
