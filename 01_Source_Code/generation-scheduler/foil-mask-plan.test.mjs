import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {businessApi} from './business-api.mjs';
import {readPlan} from './plans.mjs';

test('rose and laser mask image references survive scheduler plan upload',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'foil-mask-plan-')),jobs=[];
 const store={batch:async()=>({descriptor:{items:[{key:'LASER FOIL'}]}}),get:async()=>null,create:async(user,id,params,{prepare})=>{await prepare();const job={id,params,status:'QUEUED'};jobs.push(job);return job;}};
 const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 const server=createServer(async(req,res)=>{try{await businessApi(req,res,{store,user:'fixture',directory,enabled:false,send});}catch(error){send(res,error.status||500,{error:error.message});}});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const image='data:image/png;base64,AAAA',plan={request:{model:'gpt-image-2',prompt:'foil fixture',n:1,image_urls:[image]},roseMaskImage:null,laserMaskImage:null};
  const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/batches/${randomUUID()}/jobs/${randomUUID()}`,{method:'PUT',body:JSON.stringify({key:'LASER FOIL',plan,imageRefs:{roseMaskImage:0,laserMaskImage:0}})});
  assert.equal(response.status,202);assert.equal(jobs.length,1);
  const restored=await readPlan(directory,jobs[0].params.planHash);
  assert.equal(restored.roseMaskImage,image);assert.equal(restored.laserMaskImage,image);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
