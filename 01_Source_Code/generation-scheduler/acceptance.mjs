import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {spawn} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import pg from 'pg';
import IORedis from 'ioredis';
import {Queue,Worker} from 'bullmq';
import sharp from 'sharp';
import {createStore} from './store.mjs';
import {runStage} from './engine.mjs';

// This script never imports the real provider. It requires a separate disposable database.
const database=process.env.ACCEPTANCE_DATABASE_URL;
assert.equal(new URL(database).pathname,'/scheduler_acceptance','Dedicated acceptance database required');
const pool=new pg.Pool({connectionString:database,max:5});
await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
await pool.query('TRUNCATE job_events,jobs,business_batches,scheduler_users; UPDATE scheduler_account SET sequence=0');
const store=createStore(pool,{userRunning:2,leaseMs:120000});
const redis=new IORedis(process.env.ACCEPTANCE_REDIS_URL,{maxRetriesPerRequest:null});
const prefix='acceptance-'+randomUUID();
let queues={},workers=[],api;
const folder=await mkdtemp(join(tmpdir(),'logo-scheduler-acceptance-'));
const token=randomUUID()+randomUUID(),port=Number(process.env.ACCEPTANCE_PORT||3321);
let submissions=0,downloads=0,peak=0,firstDownload=true,releaseResults=false,completedPolls=0;
const served=[];
const remoteReady=new Map();
function remoteTask(){const id=randomUUID();remoteReady.set(id,Date.now()+1800);return id;}
const provider={
 submit:async params=>{submissions++;served.push(params.prompt);await delay(20);return {taskId:remoteTask()};},
 poll:async id=>{
  if(!releaseResults||Date.now()<(remoteReady.get(id)||0))return {status:'processing'};
  assert.equal(remoteReady.size,150,'every provider ID must exist before any remote completion');completedPolls++;
  return {status:'completed',url:'https://example.test/fixture.png'};
 },
 download:async job=>{
  downloads++;if(firstDownload){firstDownload=false;throw Error('simulated_download_failure');}
  const path=join(folder,job.id+'.png');await writeFile(path,await sharp({create:{width:16,height:16,channels:4,background:'#446688'}}).png().toBuffer());return path;
 }
};
async function processImage(job){const path=join(folder,job.id+'.webp');await sharp(job.file_path).webp().toFile(path);return path;}
async function openQueues(){
 for(const stage of ['submit','poll','download','process']){
  queues[stage]=new Queue(prefix+'-'+stage,{connection:redis,defaultJobOptions:{removeOnComplete:true,removeOnFail:100}});
  await queues[stage].setGlobalConcurrency({submit:1,poll:4,download:2,process:1}[stage]);
  const worker=new Worker(prefix+'-'+stage,async qj=>{
   const job=await store.get(qj.data.userId,qj.data.id);
   if(job?.lease_token===qj.data.token)await runStage(stage,job,{store,provider,processImage,pollMs:0});
  },{connection:redis,concurrency:{submit:1,poll:4,download:2,process:1}[stage]});
  worker.on('error',error=>console.error(error.message));workers.push(worker);
 }
}
async function stopQueues(){await Promise.all(workers.map(w=>w.close()));workers=[];await Promise.all(Object.values(queues).map(q=>q.close()));queues={};}
async function tick(){
 await store.recover();
 for(const stage of ['submit','poll','download','process']){
  const job=stage==='submit'?await store.reserve({submitConcurrency:1}):await store.claim(stage);
  if(job)await queues[stage].add(stage,{id:job.id,userId:job.user_id,token:job.lease_token},{jobId:job.lease_token});
 }
 peak=Math.max(peak,(await pool.query('SELECT count(*)::int n FROM jobs WHERE slot_reserved')).rows[0].n);
}
async function splitChinesePost(url,options){
 const bytes=Buffer.from(options.body),split=bytes.indexOf(Buffer.from('中'))+1;
 return new Promise((resolve,reject)=>{
  const req=httpRequest(url,{method:'POST',headers:options.headers},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
  });req.on('error',reject);req.write(bytes.subarray(0,split));setTimeout(()=>req.end(bytes.subarray(split)),30);
 });
}
try{
 api=spawn(process.execPath,[new URL('./api.mjs',import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/,'')],{
  env:{...process.env,DATABASE_URL:database,REDIS_URL:process.env.ACCEPTANCE_REDIS_URL,SCHEDULER_TOKEN:token,PROVIDER_ENABLED:'true',PORT:String(port)},stdio:['ignore','pipe','pipe']
 });
 let apiLog='';api.stdout.on('data',b=>{apiLog+=b;});api.stderr.on('data',b=>{apiLog+=b;});
 for(let n=0;n<100&&!apiLog.includes('scheduler_api_ready');n++)await delay(50);
 assert.ok(apiLog.includes('scheduler_api_ready'),apiLog);
 const base='http://127.0.0.1:'+port;
 assert.equal((await (await fetch(base+'/healthz')).json()).limits.remoteRunning,null);
 assert.equal((await fetch(base+'/v1/jobs')).status,401);
 const latencies=[];
 const accepted=await Promise.all(Array.from({length:15},async(_,u)=>{
  const jobs=[];for(let n=0;n<10;n++){
   const started=performance.now(),key=randomUUID();
   const options={method:'POST',headers:{authorization:'Bearer '+token,'x-user-id':'user-'+u,'idempotency-key':key,'content-type':'application/json'},body:JSON.stringify({model:'gpt-image-2',prompt:'user-'+u+'中文',n:1})};
   const response=await (u===0&&n===0?splitChinesePost:fetch)(base+'/v1/jobs',options);assert.equal(response.status,202);jobs.push(await response.json());latencies.push(performance.now()-started);
   if(u===0&&n===0){assert.equal((await store.get('user-0',jobs[0].id)).params.prompt,'user-0中文');const duplicate=await (await fetch(base+'/v1/jobs',options)).json();assert.equal(duplicate.id,jobs[0].id);}
  }return jobs;
 }));
 const victim=accepted[0][0].id;
 assert.equal((await fetch(base+'/v1/jobs/'+victim,{headers:{authorization:'Bearer '+token,'x-user-id':'user-1'}})).status,404);
 await openQueues();
 // Recover both a lost Redis wake-up and a submitted remote task after worker recreation.
 const reserved=await store.reserve();await store.startSubmit(reserved);
 await store.transition(reserved,'GENERATING',{provider_task_id:remoteTask()});submissions++;served.push(reserved.params.prompt);
 await store.claim('poll');await stopQueues();
 await pool.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE lease_token IS NOT NULL");
 await store.recover();await openQueues();
 const deadline=Date.now()+90000;
 while(Date.now()<deadline){
  await tick();if(!releaseResults&&peak===150)releaseResults=(await pool.query("SELECT count(*)::int n FROM jobs WHERE status='GENERATING' AND provider_task_id IS NOT NULL")).rows[0].n===150;
  const stats=await store.stats();if(stats.length===1&&stats[0].status==='SUCCEEDED'&&stats[0].count===150)break;await delay(10);
 }
 const stats=await store.stats();assert.deepEqual(stats,[{status:'SUCCEEDED',count:150}]);
 assert.equal(submissions,150);assert.equal(downloads,151);assert.equal(peak,150);assert.equal(completedPolls,150);
 assert.equal(new Set(served.slice(0,15)).size,15);
 assert.equal((await pool.query('SELECT count(*)::int n FROM jobs WHERE slot_reserved')).rows[0].n,0);
 latencies.sort((a,b)=>a-b);
 console.log(JSON.stringify({ok:true,users:15,jobs:150,remoteSubmissions:submissions,downloadAttempts:downloads,peakRemoteSlots:peak,allSubmittedBeforeAnyRemoteCompletion:releaseResults&&completedPolls===150,firstRoundUniqueUsers:15,postP95Ms:Math.round(latencies[Math.ceil(latencies.length*.95)-1]),workerRecreation:true,lostQueueWakeupRecovered:true,privateJobReadBlocked:true,paidRequests:0}));
}finally{
 if(api){api.kill();await Promise.race([new Promise(resolve=>api.once('exit',resolve)),delay(5000)]);}
 await stopQueues();
 for(const stage of ['submit','poll','download','process']){const q=new Queue(prefix+'-'+stage,{connection:redis});await q.obliterate({force:true});await q.close();}
 redis.disconnect();await pool.end();await rm(folder,{recursive:true,force:true});
}
