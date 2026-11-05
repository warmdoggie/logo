import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
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
 const products=ids.map(id=>({id,sku:id,name:id,imageBytes:base,template:{id:'master-'+id,version:1,zones:[{id,zoneType:'logo',x:.3,y:.3,width:.2,height:.1}],automation:{carriers:[{id:'body',type:'BODY'}],areas:[{id:'area',zoneId:id,carrierId:'body',foilProcesses:['GOLD FOIL','SILVER FOIL']}]}}}));
 const layouts=ids.map((id,index)=>{const targets=[{id,masterZoneId:kind==='logo'?'one':id,x:.2+index*.15,y:.5,widthRatio:.2,rotation:0}];return {targets,schemes:createSchemes(targets).schemes};});
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

for(const kind of ['product','logo'])for(const fixedGold of [false,true])test(`${kind} 批次的四种方案全部本地生成，固定烫金=${fixedGold}`,{timeout:15000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-apimart-batch-')),configPath=join(dir,'config.json');
 const image=await sharp({create:{width:32,height:32,channels:4,background:'#ccc'}}).png().toBuffer();
 const logo=await sharp(Buffer.from('<svg width="24" height="12"><path fill="black" fill-rule="evenodd" d="M0 0H24V12H0Z M7 3V9H17V3Z"/></svg>')).png().toBuffer();
 let requests=0;
 const renderer=createAiMockupRenderer({configPath,pollIntervalMs:0,transport:async()=>{requests++;throw Error('本地上样不能调用外部服务');}});
 const targets=[{id:'body',masterZoneId:'body',x:.5,y:.5,widthRatio:.25,rotation:0,...(fixedGold?{printFinish:'GOLD FOIL'}:{})}],schemes=createSchemes(targets).schemes;
 const server=createDemoServer({spaceDir:dir,authenticate:async()=>({id:'alice'}),productCatalog:async()=>['a','b'].map(id=>({id,sku:id,name:id,imageBytes:image,template:{id:'master-'+id,version:1,zones:[{id:'body',zoneType:'logo',x:.4,y:.4,width:.25,height:.1}],automation:{carriers:[{id:'body',type:'BODY'}],areas:[{id:'area',zoneId:'body',carrierId:'body',foilProcesses:['GOLD FOIL','SILVER FOIL']}]}}})),mockupRenderer:renderer});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const call=(path,input)=>fetch(origin+path,{method:input?'POST':'GET',headers:{'content-type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});
 const task=await(await call('/api/my-space/tasks',{title:'Local batch'})).json();
 const wait=async()=>{for(let n=0;n<300;n++){const record=await(await call(`/api/my-space/tasks/${task.id}/generation`)).json();if(record.status!=='running')return record;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('批次未完成');};
 try{
  const input=kind==='product'?{background:true,productIds:['a','b'],productLayouts:['a','b'].map(productId=>({productId,targets,schemes})),logoImage:logo.toString('base64')}:{productId:'a',logoLayouts:['a','b'].map(logoId=>({logoId,targets,schemes})),logos:['a','b'].map(id=>({id,name:id,logoImage:logo.toString('base64')}))};
  const response=await call(kind==='product'?'/api/ai-render-multi':'/api/ai-render-logos',{...input,taskId:task.id,model:'local'});assert.equal(response.status,202,await response.text());
  const complete=await wait();assert.equal(complete.status,'complete');assert.equal(complete.outputs.length,8);assert.equal(requests,0);
  for(const id of ['a','b'])assert.deepEqual(complete.outputs.filter(output=>(kind==='product'?output.productId:output.logoId)===id).map(output=>output.version).sort(),[...versions].sort());
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
