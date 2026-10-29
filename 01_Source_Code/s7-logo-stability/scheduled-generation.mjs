import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {buildAiMockupPlan} from './ai-mockup-generation.mjs';
import {getAiMockupProviderStatus,isLocalSilver,mockupResumeCheckpoint} from './ai-mockup-provider.mjs';

const terminal=new Set(['SUCCEEDED','FAILED','CANCELLED','DOWNLOAD_FAILED','PROCESS_FAILED']);
const stages={QUEUED:'queued',SUBMITTING:'submitting',GENERATING:'generating',REMOTE_SUCCEEDED:'saving',DOWNLOADING:'saving',DOWNLOADED:'saving',PROCESSING:'saving',SUCCEEDED:'complete'};
const errors={SUBMISSION_UNKNOWN:'提交结果待核查，系统不会重复提交扣费',DOWNLOAD_FAILED:'成图下载失败，已保留上游结果',PROCESS_FAILED:'图片处理失败，已保留原图',FAILED:'上游生成失败',CANCELLED:'已取消'};
const fail=(message,status=503)=>{throw Object.assign(Error(message),{status});};

export function createScheduledGenerations({spaces,url,token,configPath,autoStart=true}={}){
 if(!url||!token){
  if(!process.env.S7_SCHEDULER_CONFIG)return null;
  ({url,token}=JSON.parse(readFileSync(process.env.S7_SCHEDULER_CONFIG,'utf8')));
 }
 const endpoint=new URL(url);
 if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||token.length<40)throw Error('Invalid internal scheduler configuration');
 const pending=new Map();let refreshing=false;
 async function request(user,path,{method='GET',body,binary=false}={}){
  const response=await fetch(endpoint.origin+path,{method,headers:{Authorization:'Bearer '+token,'X-User-ID':user.id,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
  if(!response.ok){const error=await response.json();fail(error.error==='disk_reserve_required'?'磁盘空间不足，已暂停接收新任务':error.error==='Pending job quota reached'?'待处理图片过多，请完成部分任务后再提交':`任务调度暂不可用（${error.error||response.status}）`,response.status);}
  return binary?Buffer.from(await response.arrayBuffer()):response.json();
 }
 async function sync(user,id){
  let batch=await request(user,'/v1/batches/'+id);const {taskId,generation,items}=batch.descriptor;
  try{await spaces.task(user,taskId);}catch(error){
   if(error.status!==404)throw error;
   if(batch.status==='PREPARING')await request(user,'/v1/batches/'+id+'/abort',{method:'POST'});
   await request(user,'/v1/batches/'+id+'/ack',{method:'POST'});return null;
  }
  if(batch.status==='PREPARING'){
   const action=batch.jobs.length===items.length?'commit':Date.now()-Date.parse(batch.createdAt)>600000?'abort':null;
   if(action){await request(user,'/v1/batches/'+id+'/'+action,{method:'POST'});batch=await request(user,'/v1/batches/'+id);}
  }
  let current=await spaces.generation(user,taskId);
  if(current&&current.id!==id&&Date.parse(current.createdAt||0)>=Date.parse(generation.createdAt)){if(batch.jobs.every(job=>terminal.has(job.status)))await request(user,'/v1/batches/'+id+'/ack',{method:'POST'});return current;}
  if(current?.id!==id)current=null;
  const outputs=[...(current?.outputs||generation.outputs||[])],phases={...(current?.stages||generation.stages||{})},remoteTasks={};
  for(const item of items)if(!batch.jobs.some(job=>job.key===item.key))phases[item.key]=batch.status==='ABORTED'?{stage:'failed',error:'任务准备中断，尚未提交，可重试'}:{stage:'queued',label:'正在保存任务参数'};
  for(const job of batch.jobs){
   const item=items.find(item=>item.key===job.key);
   const storageReady=phases[item.key]?.storageReady;
   phases[item.key]={stage:stages[job.status]||'failed',schedulerJobId:job.id,...(job.storage?{storageReady:true}:{}),...(job.localResult?{label:'图片已生成，正在同步存储'}:{}),...(job.status==='QUEUED'&&!job.local&&!batch.providerEnabled?{label:'已排队，等待启用生成'}:{}),...(errors[job.status]?{error:errors[job.status]}:{})};
   if(job.providerTaskId)remoteTasks[item.key]={taskId:job.providerTaskId,schedulerJobId:job.id};
   if(job.status==='SUCCEEDED'||job.localResult){
    if(!outputs.some(output=>output.schedulerJobId===job.id)||job.storage&&!storageReady){
     const bytes=await request(user,'/v1/jobs/'+job.id+'/result',{binary:true});
     const saved=await spaces.save(user,{recordId:job.id,taskId,kind:generation.kind==='multi-logo'?'多 Logo 印刷效果':generation.kind==='multi-product'?'多包材印刷效果':'AI上样',model:generation.model,images:[{label:item.label,bytes,...(job.storage?{storage:job.storage}:{})}]});
     const output={...item.output,version:item.version,dataUrl:saved.images[0].url,schedulerJobId:job.id};
     const same=old=>old.version===output.version&&old.productId===output.productId&&old.logoId===output.logoId;
     for(let n=outputs.length-1;n>=0;n--)if(same(outputs[n]))outputs.splice(n,1);
     outputs.push(output);
    }
    delete remoteTasks[item.key];
   }
  }
  const done=(batch.status==='ABORTED'||batch.jobs.length===items.length)&&batch.jobs.every(job=>terminal.has(job.status));
  const activationPending=!batch.providerEnabled&&batch.jobs.some(job=>job.status==='QUEUED'&&!job.local);
  current=await spaces.updateGeneration(user,taskId,old=>old&&old.id!==id&&Date.parse(old.createdAt||0)>=Date.parse(generation.createdAt)?old:{...generation,...(old?.id===id?old:{}),scheduler:true,status:done?(Object.values(phases).every(phase=>phase.stage==='complete')?'complete':outputs.length?'partial':'failed'):'running',providerActivationPending:activationPending,outputs,stages:phases,remoteTasks,updatedAt:new Date().toISOString()});
  if(done)await request(user,'/v1/batches/'+id+'/ack',{method:'POST'});
  return current;
 }
 function project(user,id){
  const key=user.id+':'+id;if(pending.has(key))return pending.get(key);
  const operation=sync(user,id).finally(()=>pending.delete(key));pending.set(key,operation);return operation;
 }
 async function refresh(){
  if(refreshing)return;refreshing=true;
  try{
   let after='';
   for(;;){
    const batches=(await request({id:'projector'},'/v1/active-batches'+(after?'?after='+after:''))).batches;
    for(const batch of batches){try{await project({id:batch.user_id},batch.id);}catch{console.error('scheduler_batch_projection_pending',batch.id);}}
    if(batches.length<100)break;after=batches.at(-1).id;
   }
  }
  finally{refreshing=false;}
 }
 if(autoStart){const timer=setInterval(()=>refresh().catch(()=>console.error('scheduler_projection_pending')),5000);timer.unref();void refresh().catch(()=>console.error('scheduler_projection_pending'));}
 return {
  async start(user,taskId,metadata,inputs){
   await spaces.task(user,taskId);
   const previous=await spaces.generation(user,taskId);
   if(previous?.status==='running')fail('当前任务正在生成，请等待完成',409);
   const provider=getAiMockupProviderStatus(configPath);
   if(!provider.configured||!provider.models.includes(metadata.model))fail('请选择已配置的成图模型',400);
   const id=randomUUID(),stamp=new Date().toISOString(),plans=[];
   for(const item of inputs)for(const plan of buildAiMockupPlan(item.input)){
    if(await isLocalSilver(plan))plan.local=true;
    const output={...item.output,...(item.schemeSignatures?.[plan.version]?{schemeSignature:item.schemeSignatures[plan.version]}:{})};
    plans.push({plan,key:[output.productId||output.logoId,plan.version].filter(Boolean).join(':'),version:plan.version,output,label:item.label?`${item.label} · ${plan.version}`:plan.version,requestId:randomUUID()});
   }
   const generation={...metadata,id,scheduler:true,status:'running',createdAt:stamp,updatedAt:stamp,remoteTasks:{},stages:{...metadata.stages,...Object.fromEntries(plans.map(item=>[item.key,{stage:'queued'}]))}};
   const descriptor={taskId,generation,items:plans.map(({plan,requestId,...item})=>item)};
   try{
    await request(user,'/v1/batches',{method:'POST',body:{id,descriptor}});
    for(const item of plans)await request(user,`/v1/batches/${id}/jobs/${item.requestId}`,{method:'PUT',body:{key:item.key,plan:item.plan,resumeJobId:previous?.stages?.[item.key]?.schedulerJobId,resumeTask:mockupResumeCheckpoint(item.plan,previous?.remoteTasks?.[item.key],configPath)}});
    await spaces.updateGeneration(user,taskId,current=>{if(current?.status==='running'&&current.id!==id)fail('当前任务正在生成，请等待完成',409);return current?.id===id?current:generation;});
    await request(user,'/v1/batches/'+id+'/commit',{method:'POST'});
   }catch(error){
    // A lost commit acknowledgement may already have released the batch. Never replace it with another batch.
    const batch=await request(user,'/v1/batches/'+id).catch(()=>null);
    if(batch?.status==='READY')return project(user,id);
    if(batch?.status==='PREPARING')await request(user,'/v1/batches/'+id+'/abort',{method:'POST'});
    if(batch)await spaces.updateGeneration(user,taskId,current=>current?.id===id?{...current,status:'failed',stages:Object.fromEntries(Object.keys(current.stages).map(key=>[key,{stage:'failed',error:'任务尚未提交，请重试'}]))}:current);
    throw error;
   }
   return project(user,id);
  },
  async read(user,taskId){await spaces.task(user,taskId);const latest=await request(user,'/v1/tasks/'+taskId+'/batch');return latest?project(user,latest.id):spaces.generation(user,taskId);},
  refresh
 };
}
