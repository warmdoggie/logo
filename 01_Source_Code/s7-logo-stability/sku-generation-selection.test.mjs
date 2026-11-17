import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {createSchemes,ensureMixedSchemes} from './schemes.mjs';
import * as selections from './generation-versions.mjs';
import {businessApi} from '../generation-scheduler/business-api.mjs';
import {readPlan} from '../generation-scheduler/plans.mjs';

const gold='MIX_GOLD_ORIGINAL',ordinary='MIX_ORIGINAL_ORIGINAL',carton='MIX_ORIGINAL_GOLD';
async function fixture(run,{scheduled=false,renderer}={}){
 const directory=await mkdtemp(join(tmpdir(),'sku-versions-'));
 const image=await sharp({create:{width:64,height:64,channels:4,background:'#cccccc'}}).png().toBuffer();
 const products=[['l','L0043'],['f','F0083']].map(([id,sku])=>({id,sku,name:sku,imageBytes:image}));
 const template=product=>({id:'master-'+product.id,version:1,zones:[{id:'body',zoneType:'logo',name:'产品',x:.1,y:.1,width:.3,height:.8},{id:'carton',zoneType:'logo',name:'彩盒',x:.6,y:.1,width:.3,height:.8}],automation:{carriers:[{id:'b',type:'BODY'},{id:'c',type:'CARTON'}],areas:[{zoneId:'body',carrierId:'b',foilProcesses:product.id==='l'?['GOLD FOIL']:[]},{zoneId:'carton',carrierId:'c',foilProcesses:[]}]}});
 const targets=[{id:'body',masterZoneId:'body',carrierType:'BODY',x:.25,y:.5,widthRatio:.15},{id:'carton',masterZoneId:'carton',carrierType:'CARTON_FRONT',x:.75,y:.5,widthRatio:.15}];
 const layout=(productId,selectedVersions)=>({productId,selectedVersions,targets,schemes:ensureMixedSchemes(createSchemes(targets),[gold,ordinary,carton]).schemes});
 const calls=[],loaded=[],plans=[];let batch,schedulerServer,schedulerOptions;
 if(scheduled){
  const store={
   async latestBatch(){return batch;},
   async beginBatch(user,id,descriptor){batch={id,user_id:user,descriptor,created_at:new Date().toISOString(),status:'PREPARING',jobs:[]};},
   async batch(){return batch;},
   async create(user,id,params,{prepare}){await prepare();const job={id,params,status:'QUEUED'};plans.push(await readPlan(directory,params.planHash));batch.jobs.push(job);return job;},
   async commitBatch(){batch.status='READY';return batch;},
   async abortBatch(){batch.status='ABORTED';return batch;}
  };
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  schedulerServer=createServer(async(req,res)=>{try{if(!await businessApi(req,res,{store,user:'tester',directory,enabled:false,send}))send(res,404,{error:'not_found'});}catch(error){send(res,error.status||500,{error:error.message});}});
  await new Promise(resolve=>schedulerServer.listen(0,'127.0.0.1',resolve));
  schedulerOptions={url:'http://127.0.0.1:'+schedulerServer.address().port,token:'test-only-'.repeat(6),configPath:join(directory,'no-provider.json'),autoStart:false};
 }
 const server=createDemoServer({spaceDir:directory,schedulerOptions,authenticate:async()=>({id:'tester'}),productCatalog:async()=>products,productTemplate:async product=>{loaded.push(product.id);return {template:template(product)};},mockupRenderer:async input=>{calls.push(input.selectedVersions);if(renderer)return renderer(input);const outputs=input.selectedVersions.map(version=>({version,bytes:image}));for(const output of outputs)await input.onOutput?.(output);return outputs;}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const post=(path,input)=>fetch(url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
 const input={productIds:['l','f'],selectedVersions:[gold,ordinary],productLayouts:[layout('l',[gold]),layout('f',[ordinary])],logoImage:image.toString('base64'),model:'local'};
 const read=async taskId=>(await fetch(url+'/api/my-space/tasks/'+taskId+'/generation')).json();
 try{await run({post,read,input,layout,calls,loaded,plans});}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(schedulerServer){schedulerServer.closeAllConnections();await new Promise(resolve=>schedulerServer.close(resolve));}await rm(directory,{recursive:true,force:true});}
}

test('per-SKU selection validates exact union, legacy fallback, skipped products and malformed requests',()=>{
 assert.equal(typeof selections.productGenerationVersions,'function');
 const select=selections.productGenerationVersions;
 const input={productIds:['l','f'],selectedVersions:[gold,ordinary],productLayouts:[{productId:'l',selectedVersions:[gold]},{productId:'f',selectedVersions:[ordinary]}]};
 assert.deepEqual(select(input,'l'),[gold]);assert.deepEqual(select(input,'f'),[ordinary]);
 assert.deepEqual(select({productIds:['l','f'],selectedVersions:['BLACK']},'l'),['BLACK']);
 assert.deepEqual(select({...input,selectedVersions:[gold],productLayouts:[{productId:'l',selectedVersions:[gold]},{productId:'f',selectedVersions:[]}]},'f'),[]);
 for(const productLayouts of [[{productId:'l',selectedVersions:['INVALID']}],[{productId:'l',selectedVersions:[gold,gold]}],[{productId:'unknown',selectedVersions:[]}],[{productId:'l',selectedVersions:[]},{productId:'f',selectedVersions:[]}],[{productId:'l',selectedVersions:[gold]},{productId:'f',selectedVersions:[gold]}]])assert.throws(()=>select({...input,productLayouts},'l'),{status:400});
 assert.throws(()=>select({...input,selectedVersions:[ordinary]},'l'),{status:400});
 assert.throws(()=>select({...input,selectedVersions:[gold,ordinary,gold]},'l'),{status:400});
 assert.throws(()=>select({...input,onlyProductId:'missing'},'l'),{status:400});
});

test('HTTP stream permits L0043 product foil while F0083 requests ordinary printing only',()=>fixture(async({post,input,calls})=>{
 const preview=await post('/api/foil-preflight',{...input,foilMode:'multi-product'});assert.equal(preview.status,200);assert.deepEqual((await preview.json()).blocked,[]);
 const response=await post('/api/ai-render-multi',input);assert.equal(response.status,200,await response.clone().text());
 const stream=await response.text();assert.match(stream,/"completed":2/);assert.match(stream,/"total":2/);assert.deepEqual(calls,[[gold],[ordinary]]);
}));

test('HTTP rejects foil on banned SKU and rejects empty or crafted selections before rendering',()=>fixture(async({post,input,layout,calls})=>{
 const banned=await post('/api/ai-render-multi',{...input,productLayouts:[layout('l',[ordinary]),layout('f',[gold])]});assert.equal(banned.status,422);assert.equal((await banned.json()).code,'FOIL_BLOCKED');
 for(const altered of [{selectedVersions:[gold],productLayouts:[layout('l',[]),layout('f',[])]},{productLayouts:[layout('l',[gold]),layout('f',['UNKNOWN'])]},{productLayouts:[layout('l',[gold,gold]),layout('f',[ordinary])]},{onlyProductId:'f',selectedVersions:[gold],productLayouts:[layout('l',[gold]),{productId:'f',selectedVersions:[]}]}]){
  const response=await post('/api/ai-render-multi',{...input,...altered});assert.equal(response.status,400,await response.clone().text());
 }
 assert.deepEqual(calls,[]);
}));

test('carton acknowledgement is bound to which SKU requests each version',()=>fixture(async({post,input,layout,calls})=>{
 const value={...input,selectedVersions:[ordinary,carton],productLayouts:[layout('l',[carton]),layout('f',[ordinary])]};
 const response=await post('/api/foil-preflight',{...value,foilMode:'multi-product'}),preview=await response.json();assert.equal(response.status,200);assert.equal(preview.warnings.length,1);assert.equal(preview.warnings[0].sku,'L0043');assert.ok(preview.confirmationToken);
 const changed=await post('/api/ai-render-multi',{...value,productLayouts:[layout('l',[ordinary]),layout('f',[carton])],foilAcknowledgement:preview.confirmationToken});assert.equal(changed.status,409);assert.deepEqual(calls,[]);
 const accepted=await post('/api/ai-render-multi',{...value,foilAcknowledgement:preview.confirmationToken});assert.equal(accepted.status,200);assert.match(await accepted.text(),/"completed":2/);
}));

test('HTTP stream skips unselected SKU without loading its master',()=>fixture(async({post,input,layout,calls,loaded})=>{
 const response=await post('/api/ai-render-multi',{...input,selectedVersions:[gold],productLayouts:[layout('l',[gold]),{productId:'f',selectedVersions:[]}]});assert.equal(response.status,200,await response.clone().text());
 const stream=await response.text();assert.match(stream,/"total":1/);assert.doesNotMatch(stream,/"id":"f"/);assert.deepEqual(calls,[[gold]]);assert.deepEqual(loaded,['l']);
}));

test('master validation ignores stale targets in a version that no SKU requested',()=>fixture(async({post,input})=>{
 input.productLayouts[0].schemes.find(scheme=>scheme.version==='BLACK').targets[0].masterZoneId='old-zone';
 const response=await post('/api/ai-render-multi',input);assert.equal(response.status,200,await response.clone().text());assert.match(await response.text(),/"completed":2/);
}));

test('HTTP background persists only requested SKU/version pairs and preserves siblings on retry',()=>fixture(async({post,read,input,layout,calls})=>{
 const task=await(await post('/api/my-space/tasks',{title:'SKU scoped'})).json();
 const response=await post('/api/ai-render-multi',{...input,background:true,taskId:task.id});assert.equal(response.status,202,await response.clone().text());
 assert.deepEqual(Object.keys((await response.json()).stages).sort(),['f:'+ordinary,'l:'+gold].sort());
 let record;for(let n=0;n<200;n++){record=await read(task.id);if(record.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(record.status,'complete');assert.deepEqual(record.outputs.map(output=>[output.productId,output.version]).sort(),[['f',ordinary],['l',gold]]);
 const sibling=record.outputs.find(output=>output.productId==='f');
 const retry=await post('/api/ai-render-multi',{...input,selectedVersions:[gold],productLayouts:[layout('l',[gold]),{productId:'f',selectedVersions:[]}],background:true,taskId:task.id,onlyProductId:'l'});assert.equal(retry.status,202);
 for(let n=0;n<200;n++){record=await read(task.id);if(record.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(record.status,'complete');assert.deepEqual(record.outputs.find(output=>output.productId==='f'),sibling);assert.deepEqual(calls.slice(0,2).sort(),[[gold],[ordinary]].sort());assert.deepEqual(calls[2],[gold]);
}));

test('HTTP scheduled batch stages only the selected SKU/version pairs',()=>fixture(async({post,input,calls,plans})=>{
 const task=await(await post('/api/my-space/tasks',{title:'Scheduled SKU choices'})).json();
 const response=await post('/api/ai-render-multi',{...input,background:true,taskId:task.id});assert.equal(response.status,202,await response.clone().text());
 const record=await response.json();assert.equal(record.scheduler,true);assert.deepEqual(Object.keys(record.stages).sort(),['f:'+ordinary,'l:'+gold].sort());
 assert.deepEqual(plans.map(plan=>plan.version),[gold,ordinary]);assert.ok(plans.every(plan=>plan.local));assert.deepEqual(calls,[]);
},{scheduled:true}));

for(const scheduled of [false,true])test(`HTTP ${scheduled?'scheduled':'background'} skips SKU without targets, master or extra stages`,()=>fixture(async({post,read,input,layout,calls,loaded,plans})=>{
 const task=await(await post('/api/my-space/tasks',{title:'Skip SKU'})).json();
 const response=await post('/api/ai-render-multi',{...input,selectedVersions:[gold],productLayouts:[layout('l',[gold]),{productId:'f',selectedVersions:[]}],background:true,taskId:task.id});assert.equal(response.status,202,await response.clone().text());
 let record=await response.json();assert.deepEqual(Object.keys(record.stages),['l:'+gold]);assert.deepEqual(loaded,['l']);
 if(scheduled){assert.deepEqual(plans.map(plan=>plan.version),[gold]);assert.deepEqual(calls,[]);}
 else{for(let n=0;n<200;n++){record=await read(task.id);if(record.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(record.status,'complete');assert.deepEqual(record.outputs.map(output=>[output.productId,output.version]),[['l',gold]]);}
},{scheduled}));

for(const callback of ['onStage','onCheckpoint'])test(`background rejects unrequested version ${callback} updates`,()=>fixture(async({post,read,input,layout})=>{
 const task=await(await post('/api/my-space/tasks',{title:'Reject stray version'})).json();
 const response=await post('/api/ai-render-multi',{...input,selectedVersions:[gold],productLayouts:[layout('l',[gold]),{productId:'f',selectedVersions:[]}],background:true,taskId:task.id});assert.equal(response.status,202);
 let record;for(let n=0;n<200;n++){record=await read(task.id);if(record.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.deepEqual(Object.keys(record.stages),['l:'+gold]);assert.deepEqual(record.remoteTasks,{});assert.equal(record.status,'failed');
},{renderer:async input=>{if(callback==='onStage')await input.onStage(ordinary,'complete');else await input.onCheckpoint(ordinary,{taskId:'unrequested'});return [];}}));
