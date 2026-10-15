import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';

test('S7 多任务独立保存草稿、素材和结果，跨任务及跨用户文件访问被拒绝',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-tasks-'));let server,base;
 const image=await sharp({create:{width:20,height:20,channels:4,background:'#000'}}).png().toBuffer();
 async function start(){server=createDemoServer({spaceDir:dir,authenticate:async req=>({id:req.headers.cookie||'alice'}),mockupRenderer:async()=>[{version:'ORIGINAL',bytes:image}]});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;}
 const call=(path,data,method=data?'POST':'GET',user='alice')=>fetch(base+path,{method,headers:{cookie:user,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 try{
  await start();const first=await call('/api/my-space/tasks',{title:'客户 A'});assert.equal(first.status,201);const a=await first.json(),b=await(await call('/api/my-space/tasks',{title:'客户 B'})).json();assert.notEqual(a.id,b.id);
  const state={baseData:'base-a',logoData:'logo-a',targets:[{id:'p',x:.2,y:.4}],model:'flux-3-image'};
  assert.equal((await call('/api/my-space/tasks/'+a.id,{revision:a.revision,state},'PUT')).status,200);
  assert.deepEqual((await(await call('/api/my-space/tasks/'+a.id)).json()).state,state);
  assert.deepEqual((await(await call('/api/my-space/tasks/'+b.id)).json()).state,{});
  assert.equal((await call('/api/my-space/tasks/'+a.id,{revision:0,state:{logoData:'stale'}},'PUT')).status,409);
  const input={taskId:a.id,baseImage:image.toString('base64'),logoImage:image.toString('base64'),targets:[{id:'p',x:.5,y:.5,widthRatio:.2,rotation:0}]};
  assert.equal((await call('/api/ai-render',input)).status,200);
  const history=await(await call('/api/my-space/history?taskId='+a.id)).json();assert.equal(history.length,1);
  assert.deepEqual(await(await call('/api/my-space/history?taskId='+b.id)).json(),[]);
  const url=history[0].images[0].url;assert.equal((await call(url)).status,200);assert.equal((await call(url.replace(a.id,b.id))).status,404);assert.equal((await call(url,undefined,'GET','bob')).status,404);
  assert.equal((await call('/api/my-space/tasks/'+a.id,undefined,'GET','bob')).status,404);
  assert.equal((await call('/api/ai-render',input,'POST','bob')).status,404);
  await new Promise(resolve=>server.close(resolve));await start();
  assert.deepEqual((await(await call('/api/my-space/tasks/'+a.id)).json()).state,state);
  assert.equal((await(await call('/api/my-space/tasks')).json()).length,2);
  assert.equal((await call('/api/my-space/tasks',{title:'   '})).status,400);
  assert.equal((await call('/api/my-space/tasks/'+a.id,undefined,'DELETE','bob')).status,404);
  assert.equal((await call('/api/my-space/tasks/'+a.id,undefined,'DELETE')).status,204);
  assert.equal((await call('/api/my-space/tasks/'+a.id)).status,404);
  assert.equal((await call('/api/my-space/history?taskId='+a.id)).status,404);
  assert.equal((await call(url)).status,404);
  assert.deepEqual((await(await call('/api/my-space/tasks')).json()).map(task=>task.id),[b.id]);
 }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
