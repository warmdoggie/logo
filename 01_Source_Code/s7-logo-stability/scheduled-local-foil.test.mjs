import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createScheduledGenerations} from './scheduled-generation.mjs';
import {userSpace} from './user-space.mjs';
import {renderLogoSet} from './index.mjs';
import {businessApi} from '../generation-scheduler/business-api.mjs';
import {readPlan} from '../generation-scheduler/plans.mjs';
import {processScheduledImage} from '../generation-scheduler/images.mjs';
import {createSchemes,ensureMixedSchemes} from './schemes.mjs';

for(const selectedVersions of [['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'],['ROSE GOLD FOIL','LASER FOIL'],['MIX_ORIGINAL_GOLD','MIX_ROSE_LASER']])test(`${selectedVersions.join(', ')} enter the scheduler as local jobs without a provider configuration`,async()=>{
 const folder=await mkdtemp(join(tmpdir(),'scheduled-local-foil-')),plans=[];
 let batch;
 const store={
  async beginBatch(user,id,descriptor){batch={id,user_id:user,descriptor,created_at:new Date().toISOString(),status:'PREPARING',jobs:[]};},
  async batch(){return batch;},
  async create(user,id,params,{prepare}){await prepare();const job={id,params,status:'QUEUED'};plans.push(await readPlan(folder,params.planHash));batch.jobs.push(job);return job;},
  async commitBatch(){batch.status='READY';return batch;},
  async abortBatch(){batch.status='ABORTED';return batch;}
 };
 const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 const server=createServer(async(req,res)=>{
  try{if(!await businessApi(req,res,{store,user:'local-test',directory:folder,enabled:false,send}))send(res,404,{error:'not_found'});}
  catch(error){send(res,error.status||500,{error:error.message});}
 });
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const configPath=join(folder,'missing-provider.json');
  const spaces=userSpace(join(folder,'spaces')),user={id:'local-test'},task=await spaces.createTask(user,{title:'Local foil'});
  const base=await sharp({create:{width:64,height:32,channels:4,background:'#cccccc'}}).png().toBuffer(),logo=await sharp({create:{width:12,height:6,channels:4,background:'#000000'}}).png().toBuffer();
  const mixed=selectedVersions[0].startsWith('MIX_');
  const targets=mixed?[{id:'front',x:.25,y:.5,widthRatio:.2},{id:'box',carrierType:'CARTON_FRONT',x:.75,y:.5,widthRatio:.2}]:[{id:'front',x:.5,y:.5,widthRatio:.4}],data=b=>'data:image/png;base64,'+b.toString('base64');
  const schemes=mixed?ensureMixedSchemes(createSchemes(targets),selectedVersions).schemes:undefined;
  const set=await renderLogoSet({baseImage:base,logoImage:logo,targets,schemes,originalColor:'#000000',selectedVersions});
  const input={model:'local',baseImage:data(base),logoImage:data(logo),targets,schemes,originalColor:'#000000',selectedVersions,guides:set.outputs.map(o=>({version:o.version,dataUrl:data(o.bytes),maskDataUrl:data(o.mask),foilMaskDataUrl:data(o.foilMask),goldMaskDataUrl:data(o.goldMask),roseMaskDataUrl:data(o.roseMask),laserMaskDataUrl:data(o.laserMask)}))};
  const service=createScheduledGenerations({spaces,url:'http://127.0.0.1:'+server.address().port,token:'test-only-'.repeat(6),configPath,autoStart:false});
  await service.start(user,task.id,{model:'local',outputs:[]},[{input}]);
  assert.deepEqual(plans.map(plan=>[plan.version,!!plan.local]),selectedVersions.map(version=>[version,true]));
  for(const plan of plans){assert.ok(plan.roseMaskImage);assert.ok(plan.laserMaskImage);}
  for(const job of batch.jobs){
   const path=await processScheduledImage({...job,lease_token:'test-lease'},{directory:folder});
   const pixels=await sharp(path).ensureAlpha().raw().toBuffer();
   assert.deepEqual([...pixels.subarray(0,4)],[204,204,204,255]);
   if(['ORIGINAL','BLACK'].includes(job.params.key))assert.deepEqual([...pixels.subarray((16*64+32)*4,(16*64+32)*4+4)],[0,0,0,255]);
   if(job.params.key==='MIX_ORIGINAL_GOLD'){
    const pixel=[...pixels.subarray((16*64+16)*4,(16*64+16)*4+4)];
    assert.ok(pixel[0]<20);assert.equal(pixel[0],pixel[1]);assert.equal(pixel[1],pixel[2]);assert.equal(pixel[3],255);
   }
  }
 }finally{
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(folder,{recursive:true,force:true});
 }
});
