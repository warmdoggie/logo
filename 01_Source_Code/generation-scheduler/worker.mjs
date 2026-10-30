import {Worker} from 'bullmq';
import {setTimeout as delay} from 'node:timers/promises';
import {store,redis,queues,enabled,number,close} from './runtime.mjs';
import {createProvider} from './provider.mjs';
import {runStage} from './engine.mjs';
import {hasDiskSpace} from './capacity.mjs';
import {processScheduledImage} from './images.mjs';
import {appModule} from './plans.mjs';

const images=process.argv[2]==='images',directory=process.env.RESULT_DIRECTORY;
if(!directory)throw Error('RESULT_DIRECTORY required');
const provider=createProvider({directory});
let processImage;
if(images){
 const {default:sharp}=await import('sharp');sharp.concurrency(2);sharp.cache({memory:64,files:0,items:16});
 const storage=process.env.LOGO_OSS_STORAGE_ROLE_ARN?(await import(appModule('logo-generation-storage.mjs'))).createGenerationStorage():null;
 processImage=job=>processScheduledImage(job,{directory,storage});
}
const stages=images?['process']:['submit','poll','download'];
const concurrency={submit:number('PROVIDER_SUBMIT_CONCURRENCY',2,1,10),poll:4,download:2,process:1};
for(const stage of stages)await queues[stage].setGlobalConcurrency(concurrency[stage]);
if(!images){
 await queues.submit.setGlobalRateLimit(1,number('PROVIDER_SUBMIT_INTERVAL_MS',500,100,60000));
 await queues.poll.setGlobalRateLimit(number('PROVIDER_POLL_RPM',300,1,1200),60000);
}
const workers=stages.map(stage=>{
 const worker=new Worker('logo-'+stage,async queueJob=>{
  const job=await store.get(queueJob.data.userId,queueJob.data.id);
  if(!job||job.lease_token!==queueJob.data.token||new Date(job.lease_until)<=new Date())return;
  const heartbeat=setInterval(()=>store.renew(job).catch(()=>console.error('job_lease_renewal_failed',stage)),30000);
  try{await runStage(stage,job,{store,provider,processImage,allowRemote:enabled,pollMs:number('POLL_INTERVAL_MS',5000,500,60000)});}
  finally{clearInterval(heartbeat);}
 },{connection:redis,concurrency:concurrency[stage]});
 worker.on('error',()=>console.error('queue_worker_error',stage));
 worker.on('failed',()=>console.error('queue_stage_failed',stage));return worker;
});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await Promise.all(workers.map(w=>w.close()));await close();}
process.on('SIGTERM',()=>{void stop();});process.on('SIGINT',()=>{void stop();});
console.log(images?'image_worker_ready':'network_worker_ready');
while(!stopping){
 try{
  if(!images)await store.recover();
  for(const stage of stages){
   if(stage==='submit'&&!await hasDiskSpace(directory,2))continue;
   if(stage==='download'&&!await hasDiskSpace(directory,1))continue;
   for(let n=0;n<concurrency[stage];n++){
    const job=stage==='submit'?await store.reserve({allowRemote:enabled,submitConcurrency:concurrency.submit}):await store.claim(stage);if(!job)break;
    await queues[stage].add(stage,{id:job.id,userId:job.user_id,token:job.lease_token},{jobId:job.lease_token});
   }
  }
 }catch{if(!stopping)console.error('dispatcher_retry_pending');}
 await delay(1000);
}
