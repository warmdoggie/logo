import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {businessApi} from './business-api.mjs';
import {readPlan} from './plans.mjs';
import {createPlanStorage} from '../logo-plan-storage.mjs';

test('business uploads acknowledge only verified OSS plans and preserve retry fingerprints',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'scheduler-plan-api-')),batchId=randomUUID(),objects=new Map(),jobs=[];
 let offline=false;
 const remote={async put(key,data){objects.set(key,Buffer.from(data));},async getStream(key){if(offline)throw Error('OSS read unavailable');return {stream:Readable.from([objects.get(key)])};}};
 const storage=createPlanStorage({client:async()=>remote});
 const store={batch:async()=>({descriptor:{items:[{key:'BLACK'}]}}),get:async()=>null,create:async(user,id,params,{prepare})=>{await prepare();const job={id,params,status:'QUEUED'};jobs.push(job);return job;}};
 const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 const server=createServer(async(req,res)=>{try{await businessApi(req,res,{store,user:'fixture',directory,enabled:false,send,planStorage:storage});}catch{send(res,503,{error:'unavailable'});}});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const image='data:image/png;base64,AAAA',plan={request:{model:'gpt-image-2',prompt:'fixture',n:1,image_urls:[image]},baseImage:null};
  const upload=()=>fetch(`http://127.0.0.1:${server.address().port}/v1/batches/${batchId}/jobs/${randomUUID()}`,{method:'PUT',body:JSON.stringify({key:'BLACK',plan,imageRefs:{baseImage:0}})});
  offline=true;assert.equal((await upload()).status,503);assert.equal(jobs.length,0,'unverified input must never enter the queue');
  offline=false;assert.equal((await upload()).status,202);assert.equal(jobs.length,1);
  const restored={...plan,baseImage:image},hash=createHash('sha256').update(JSON.stringify(restored)).digest('hex');
  assert.equal(jobs[0].params.planHash,hash);
  assert.deepEqual(await readPlan(directory,hash,{storage:createPlanStorage({client:async()=>remote})}),restored);
  assert.deepEqual(await readdir(directory),[]);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
