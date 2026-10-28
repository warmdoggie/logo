import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {userSpace} from './user-space.mjs';

test('两产品八张图后台逐张保存，切换任务、重新读取和服务重建保留预览结果',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-batch-persist-')),user={id:'alice'};
 const image=await sharp({create:{width:32,height:32,channels:4,background:'#777'}}).png().toBuffer();
 const products=['a','b'].map(id=>({id,sku:id,name:id,imageBytes:image,template:{zones:[{id:'zone',zoneType:'logo',x:.3,y:.3,width:.2,height:.1}]}}));
 let release,entered,startedCount=0;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),calls=[];
 let server,base;
 async function listen(renderer){server=createDemoServer({spaceDir:dir,authenticate:async req=>({id:req.headers.cookie||'alice'}),productCatalog:async()=>products,mockupRenderer:renderer});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;}
 const call=(path,data,cookie='alice')=>fetch(base+path,{method:data?'POST':'GET',headers:{cookie,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const read=async id=>(await call(`/api/my-space/tasks/${id}/generation`)).json();
 try{
  await listen(async input=>{calls.push(input.selectedVersions);const outputs=input.guides.filter(g=>input.selectedVersions.includes(g.version)).map(g=>({version:g.version,bytes:image}));await input.onOutput(outputs[0]);if(++startedCount===2)entered();await gate;for(const output of outputs.slice(1))await input.onOutput(output);return outputs;});
  const task=await(await call('/api/my-space/tasks',{title:'two products'})).json();
  const response=await call('/api/ai-render-multi',{background:true,taskId:task.id,productIds:['a','b'],logoImage:image.toString('base64'),model:'test'});
  assert.equal(response.status,202,'批量生成必须立即返回后台任务，而不是一直占用流式请求');
  const accepted=await response.json();assert.equal(accepted.kind,'multi-product');assert.equal(Object.keys(accepted.stages).length,8);
  await started;let running=await read(task.id);assert.equal(running.status,'running');assert.equal(running.outputs.length,2);assert.deepEqual(running.outputs.map(output=>output.productId).sort(),['a','b']);
  assert.equal((await call(`/api/my-space/tasks/${task.id}/generation`,undefined,'bob')).status,404);
  const other=await(await call('/api/my-space/tasks',{title:'created during generation'})).json();assert.equal(await read(other.id),null);
  assert.equal((await read(task.id)).outputs[0].dataUrl,running.outputs[0].dataUrl);
  assert.equal((await call('/api/ai-render-multi',{background:true,taskId:task.id,productIds:['a','b'],logoImage:image.toString('base64'),model:'test'})).status,409);
  release();for(let n=0;n<200;n++){running=await read(task.id);if(running.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(running.status,'complete');assert.equal(running.outputs.length,8);assert.equal(Object.values(running.stages).filter(s=>s.stage==='complete').length,8);
  for(const output of running.outputs)assert.equal((await call(output.dataUrl)).status,200);
  const beforeRetry=running;
  assert.equal((await call('/api/ai-render-multi',{background:true,taskId:task.id,productIds:['a','b'],onlyProductId:'a',selectedVersions:['BLACK'],logoImage:image.toString('base64'),model:'test'})).status,202);
  for(let n=0;n<200;n++){running=await read(task.id);if(running.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(calls.length,3,'重试当前产品的一张图，不得重新生成其他七张');assert.deepEqual(calls[2],['BLACK']);
  for(const output of beforeRetry.outputs)if(output.productId!=='a'||output.version!=='BLACK')assert.equal(running.outputs.find(item=>item.productId===output.productId&&item.version===output.version).dataUrl,output.dataUrl);
  const separate=await(await call('/api/my-space/tasks',{title:'multi-logo isolation'})).json(),spaces=userSpace(dir);
  await spaces.updateTask(user,separate.id,{revision:0,state:{mode:'multi-logo'}});
  const separateJob={id:'multi-logo-job',kind:'multi-logo',status:'complete',logos:[],outputs:[],stages:{}};await spaces.updateGeneration(user,separate.id,()=>separateJob);
  assert.equal((await call('/api/ai-render-multi',{background:true,taskId:separate.id,productIds:['a','b'],logoImage:image.toString('base64'),model:'test'})).status,400);
  assert.deepEqual(await read(separate.id),separateJob);
  await new Promise(r=>server.close(r));await listen(async()=>{throw Error('恢复页面不应重新调用付费模型');});
  assert.deepEqual(await read(task.id),running);
 }finally{release();if(server?.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}await rm(dir,{recursive:true,force:true});}
});

test('已有多包材历史直接恢复为对应产品的八张预览结果，不重新生成',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-batch-history-')),spaces=userSpace(dir),user={id:'alice'};
 let server;
 try{
  const task=await spaces.createTask(user,{title:'legacy batch'});
  await spaces.updateTask(user,task.id,{revision:0,state:{multiPackageProducts:[{id:'a',sku:'L0048',name:'A'},{id:'b',sku:'L0049',name:'B'}]}});
  for(const sku of ['L0048','L0049'])await spaces.save(user,{taskId:task.id,kind:'多包材印刷效果',model:'test',images:['ORIGINAL','BLACK','GOLD FOIL','SILVER FOIL'].map(version=>({label:`${sku} · ${version}`,bytes:Buffer.from('saved image')}))});
  server=createDemoServer({spaceDir:dir,authenticate:async()=>user});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const record=await(await fetch(`http://127.0.0.1:${server.address().port}/api/my-space/tasks/${task.id}/generation`)).json();
  assert.equal(record?.kind,'multi-product');assert.equal(record.status,'complete');assert.equal(record.outputs.length,8);assert.deepEqual([...new Set(record.outputs.map(o=>o.productId))].sort(),['a','b']);
  await spaces.updateGeneration(user,task.id,()=>({id:'old-single',status:'complete',createdAt:'2000-01-01T00:00:00Z',outputs:[],stages:{}}));
  const recovered=await(await fetch(`http://127.0.0.1:${server.address().port}/api/my-space/tasks/${task.id}/generation`)).json();assert.equal(recovered.kind,'multi-product');assert.equal(recovered.outputs.length,8);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await rm(dir,{recursive:true,force:true});}
});
