import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {createSchemes} from './schemes.mjs';
import {createAiMockupRenderer} from './ai-mockup-provider.mjs';

const versions=['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'];
async function ready(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('第二组必须在第一组完成之前提交')),1500);})]);}finally{clearTimeout(timer);}}

for(const kind of ['product','logo'])test(`${kind} 批次同时运行两组，完成一组立即补位，失败及重试保持结果归属`,{timeout:15000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-batch-concurrency-'));
 const base=await sharp({create:{width:48,height:48,channels:4,background:'#ccc'}}).png().toBuffer();
 const logo=await sharp({create:{width:8,height:4,channels:4,background:'#00000000'}}).composite([{input:await sharp({create:{width:4,height:2,channels:4,background:'#c32'}}).png().toBuffer(),left:2,top:1}]).png().toBuffer();
 const ids=['one','two','three','four'],gates=new Map(ids.map(id=>[id,Promise.withResolvers()])),entered=new Map(ids.map(id=>[id,Promise.withResolvers()])),calls=[],expected=new Map();let active=0,peak=0,retrying=false;
 const products=ids.map(id=>({id,sku:id,name:id,imageBytes:base,template:{zones:[{id,zoneType:'logo',x:.3,y:.3,width:.2,height:.1}]}}));
 const layouts=ids.map((id,index)=>{const targets=[{id,x:.2+index*.15,y:.5,widthRatio:.2,rotation:0}];return {targets,schemes:createSchemes(targets).schemes};});
 const server=createDemoServer({spaceDir:dir,authenticate:async()=>({id:'alice'}),productCatalog:async()=>products,mockupRenderer:async input=>{
  const id=input.targets[0].id;calls.push(id);active++;peak=Math.max(peak,active);entered.get(id).resolve();
  try{await gates.get(id).promise;if(id==='two'&&!retrying)throw Error('上游暂时限流');
   return input.selectedVersions.map(version=>{const bytes=Buffer.from(input.guides.find(guide=>guide.version===version).dataUrl.split(',')[1],'base64');expected.set(id+':'+version,bytes);return {version,bytes};});
  }finally{active--;}
 }});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const call=(path,input)=>fetch(origin+path,{method:input?'POST':'GET',headers:{'content-type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});
 let task;
 const read=async()=>(await call(`/api/my-space/tasks/${task.id}/generation`)).json();
 const wait=async()=>{for(let n=0;n<300;n++){const record=await read();if(record.status!=='running')return record;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('批次未完成');};
 try{
  task=await(await call('/api/my-space/tasks',{title:'concurrency'})).json();
  const input=kind==='product'?{taskId:task.id,background:true,productIds:ids,logoImage:logo.toString('base64'),model:'test',productLayouts:ids.map((productId,i)=>({productId,...layouts[i]}))}:{taskId:task.id,productId:'one',model:'test',logos:ids.map(id=>({id,name:id,logoImage:logo.toString('base64')})),logoLayouts:ids.map((logoId,i)=>({logoId,...layouts[i]}))};
  const endpoint=kind==='product'?'/api/ai-render-multi':'/api/ai-render-logos';
  assert.equal((await call(endpoint,input)).status,202);
  await ready(Promise.all([entered.get('one').promise,entered.get('two').promise]));assert.equal(calls.length,2);
  const running=await read();assert.equal(running.status,'running');assert.ok(versions.every(version=>running.stages['three:'+version].stage==='queued'));
  assert.equal((await call(endpoint,input)).status,409);
  gates.get('two').resolve();await ready(entered.get('three').promise);assert.equal(calls.length,3);assert.ok(!calls.includes('four'));
  gates.get('three').resolve();await ready(entered.get('four').promise);gates.get('four').resolve();
  let lastRunning;for(let n=0;n<200;n++){lastRunning=await read();if(lastRunning.outputs.length===8)break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(lastRunning.outputs.length,8);assert.equal(lastRunning.status,'running');assert.equal((await call(endpoint,input)).status,409);
  gates.get('one').resolve();
  const partial=await wait();assert.equal(peak,2);assert.equal(partial.status,'partial');assert.equal(partial.outputs.length,12);
  assert.ok(versions.every(version=>partial.stages['two:'+version].stage==='failed'));
  for(const output of partial.outputs){const id=kind==='product'?output.productId:output.logoId;assert.ok(Buffer.from(await(await call(output.dataUrl)).arrayBuffer()).equals(expected.get(id+':'+output.version)));}
  retrying=true;const before=calls.length;
  const retry=kind==='product'?{onlyProductId:'two',selectedVersions:versions}:{retryFailed:true};
  assert.equal((await call(endpoint,{...input,...retry})).status,202);const complete=await wait();assert.equal(complete.status,'complete');assert.equal(complete.outputs.length,16);assert.deepEqual(calls.slice(before),['two']);
  for(const output of partial.outputs)assert.equal(complete.outputs.find(item=>(kind==='product'?item.productId===output.productId:item.logoId===output.logoId)&&item.version===output.version).dataUrl,output.dataUrl);
 }finally{
  for(const gate of gates.values())gate.resolve();if(task)await wait();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});
 }
});

for(const fixedGold of [false,true])test(`真实提交链路在任一远端任务完成前发出 ${fixedGold?8:6} 个 APIMart 请求`,{timeout:15000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-apimart-batch-')),configPath=join(dir,'config.json');
 await writeFile(configPath,JSON.stringify({provider:'APIMART',model:'gpt-image-2.5-flare',endpoint:'https://api.apimart.ai',apiKey:'test-key'}));
 const image=await sharp({create:{width:32,height:32,channels:4,background:'#ccc'}}).png().toBuffer();
 const gate=Promise.withResolvers(),submitted=Promise.withResolvers(),requests=[],count=fixedGold?8:6;
 const renderer=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async(url,options)=>{
  if(String(url).endsWith('/v1/images/generations')){requests.push(JSON.parse(options.body));if(requests.length===count)submitted.resolve();return Response.json({data:[{task_id:'remote-'+requests.length}]});}
  if(String(url).includes('/v1/tasks/')){await gate.promise;return Response.json({data:{status:'completed',result:{images:[{url:'https://upload.apimart.ai/result.png'}]}}});}
  return new Response(image);
 }});
 const targets=[{id:'body',x:.5,y:.5,widthRatio:.25,rotation:0,...(fixedGold?{printFinish:'GOLD FOIL'}:{})}],schemes=createSchemes(targets).schemes;
 const server=createDemoServer({spaceDir:dir,authenticate:async()=>({id:'alice'}),productCatalog:async()=>['a','b'].map(id=>({id,sku:id,name:id,imageBytes:image})),mockupRenderer:renderer});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const call=(path,input)=>fetch(origin+path,{method:input?'POST':'GET',headers:{'content-type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});
 const task=await(await call('/api/my-space/tasks',{title:'APIMart concurrency'})).json();
 const wait=async()=>{for(let n=0;n<300;n++){const record=await(await call(`/api/my-space/tasks/${task.id}/generation`)).json();if(record.status!=='running')return record;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('批次未完成');};
 try{
  const response=await call('/api/ai-render-multi',{taskId:task.id,background:true,productIds:['a','b'],productLayouts:['a','b'].map(productId=>({productId,targets,schemes})),logoImage:image.toString('base64'),model:'gpt-image-2.5-flare'});assert.equal(response.status,202);
  await ready(submitted.promise);assert.equal(requests.length,count);assert.ok(requests.every(request=>request.n===1));
  const running=await(await call(`/api/my-space/tasks/${task.id}/generation`)).json();assert.equal(running.status,'running');assert.ok(running.outputs.length<=2);
  gate.resolve();const complete=await wait();assert.equal(complete.status,'complete');assert.equal(complete.outputs.length,8);
 }finally{gate.resolve();await wait();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
