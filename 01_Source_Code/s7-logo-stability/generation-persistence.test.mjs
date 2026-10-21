import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createDemoServer} from './demo-server.mjs';
import {userSpace} from './user-space.mjs';

test('regenerating multiple edited schemes retains untouched and previous images until replacements finish',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-edited-'));
 const image=await sharp({create:{width:30,height:20,channels:4,background:'#777'}}).png().toBuffer();
 let release,entered,hold=false;
 const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const server=createDemoServer({spaceDir:dir,authenticate:async()=>({id:'alice'}),mockupRenderer:async input=>{
  if(hold){entered();await gate;}
  const outputs=input.selectedVersions.map(version=>({version,bytes:image}));
  for(const output of outputs)await input.onOutput(output);return outputs;
 }});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const call=async(path,data)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:data?'POST':'GET',headers:{'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});assert.ok(r.ok);return r.json();};
 try{
  const task=await call('/api/my-space/tasks',{title:'Edited schemes'}),path=`/api/my-space/tasks/${task.id}/generation`;
  const input={taskId:task.id,background:true,baseImage:image.toString('base64'),logoImage:image.toString('base64'),targets:[{id:'p',x:.5,y:.5,widthRatio:.2}]};
  const wait=async()=>{for(let i=0;i<150;i++){const record=await call(path);if(record.status!=='running')return record;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('not completed');};
  await call('/api/ai-render',{...input,schemeSignatures:{ORIGINAL:'original-v1',BLACK:'black-v1'}});const before=await wait();
  hold=true;
  await call('/api/ai-render',{...input,selectedVersions:['BLACK','GOLD FOIL'],preserveResults:true,schemeSignatures:{BLACK:'black-v2','GOLD FOIL':'gold-v2'}});
  await started;const during=await call(path);assert.equal(during.outputs.length,4);
  release();const after=await wait();assert.equal(after.outputs.length,4);
  assert.equal(after.outputs.find(o=>o.version==='ORIGINAL').dataUrl,before.outputs.find(o=>o.version==='ORIGINAL').dataUrl);
  assert.equal(after.outputs.find(o=>o.version==='BLACK').schemeSignature,'black-v2');
  assert.equal(after.outputs.find(o=>o.version==='ORIGINAL').schemeSignature,'original-v1');
 }finally{release();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});

test('三版本任务只记录所选阶段，恢复和单张重试保留三张结果',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-selection-'));
 const image=await sharp({create:{width:20,height:20,channels:4,background:'#777'}}).png().toBuffer();
 const calls=[],selectedVersions=['BLACK','GOLD FOIL','SILVER FOIL'];
 const server=createDemoServer({spaceDir:dir,authenticate:async()=>({id:'alice'}),mockupRenderer:async input=>{
  calls.push(input.selectedVersions);
  const outputs=input.selectedVersions.map(version=>({version,bytes:image}));
  for(const output of outputs)await input.onOutput(output);
  return outputs;
 }});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const call=(path,data)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:data?'POST':'GET',headers:{'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 try{
  const task=await(await call('/api/my-space/tasks',{title:'三个版本'})).json();
  const path=`/api/my-space/tasks/${task.id}/generation`;
  const input={background:true,taskId:task.id,selectedVersions,preserveResults:true,baseImage:image.toString('base64'),logoImage:image.toString('base64'),targets:[{id:'p',x:.5,y:.5,widthRatio:.2,rotation:0}]};
  const wait=async()=>{let record;for(let n=0;n<100;n++){record=await(await call(path)).json();if(record.status!=='running')return record;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('generation did not finish');};
  assert.equal((await call('/api/ai-render',{...input,selectedVersions:[]})).status,400);
  assert.equal(calls.length,0);
  const response=await call('/api/ai-render',input);assert.equal(response.status,202);
  assert.deepEqual(Object.keys((await response.json()).stages),selectedVersions);
  let record=await wait();assert.equal(record.status,'complete');assert.equal(record.outputs.length,3);
  assert.deepEqual(Object.keys(record.stages),selectedVersions);
  assert.deepEqual((await userSpace(dir).generation({id:'alice'},task.id)).outputs,record.outputs);
  assert.equal((await call('/api/ai-render',{...input,onlyVersion:'BLACK'})).status,202);
  record=await wait();assert.equal(record.outputs.length,3);assert.deepEqual(Object.keys(record.stages),selectedVersions);
  assert.deepEqual(calls,[selectedVersions,['BLACK']]);
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});

test('生成脱离页面和登录会话运行，逐张持久化，重进及重启恢复且用户任务隔离',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'s7-generation-'));
 const image=await sharp({create:{width:20,height:20,channels:4,background:'#777'}}).png().toBuffer();
 let release,releaseFinish,entered,outputSaved,session=true,server,base;
 const enteredPromise=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),finishGate=new Promise(resolve=>releaseFinish=resolve),savedPromise=new Promise(resolve=>outputSaved=resolve);
 const renderer=async input=>{await input.onStage(input.onlyVersion||'ORIGINAL','generating');entered();await gate;const output={version:input.onlyVersion||'ORIGINAL',bytes:image};await input.onOutput(output);outputSaved();await finishGate;return [output];};
 async function start(){server=createDemoServer({spaceDir:dir,authenticate:async req=>{if(!session)throw Object.assign(Error('请登录'),{status:401});return {id:req.headers.cookie||'alice'};},mockupRenderer:renderer});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;}
 const call=(path,data,method=data?'POST':'GET',user='alice')=>fetch(base+path,{method,headers:{cookie:user,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 try{
  await start();assert.equal((await call('/generation-client.mjs')).status,200);const task=await(await call('/api/my-space/tasks',{title:'任务 A'})).json(),other=await(await call('/api/my-space/tasks',{title:'任务 B'})).json();
  const path=`/api/my-space/tasks/${task.id}/generation`,input={background:true,taskId:task.id,baseImage:image.toString('base64'),logoImage:image.toString('base64'),targets:[{id:'p',x:.5,y:.5,widthRatio:.2,rotation:0}]};
  assert.equal((await call('/api/ai-render',input)).status,202);
  await enteredPromise;
  const running=await(await call(path)).json();assert.equal(running.status,'running');assert.equal(running.stages.ORIGINAL.stage,'generating');assert.equal(Object.keys(running.stages).length,4);
  assert.equal((await call('/api/ai-render',input)).status,409);
  assert.equal((await call(`/api/my-space/tasks/${task.id}`,null,'DELETE')).status,409);
  assert.equal((await call(path,null,'GET','bob')).status,404);
  assert.equal(await(await call(`/api/my-space/tasks/${other.id}/generation`)).json(),null);
  session=false;assert.equal((await call(path)).status,401);release();
  let deadline;try{await Promise.race([savedPromise,new Promise((_,reject)=>deadline=setTimeout(()=>reject(Error('退出后图片没有保存')),2000))]);}finally{clearTimeout(deadline);}
  const stored=userSpace(dir),partial=await stored.generation({id:'alice'},task.id);
  assert.equal(partial.status,'running');assert.equal(partial.outputs.length,1);releaseFinish();
  session=true;let completed;
  for(let n=0;n<100;n++){completed=await(await call(path)).json();if(completed.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(completed.status,'complete');assert.equal(completed.outputs.length,1);assert.equal(completed.stages.ORIGINAL.stage,'complete');assert.equal(completed.stages.BLACK.stage,'failed');
  assert.equal((await call(completed.outputs[0].dataUrl)).status,200);
  await new Promise(resolve=>server.close(resolve));await start();
  assert.deepEqual(await(await call(path)).json(),completed);
  assert.equal((await call('/api/ai-render',{...input,onlyVersion:'BLACK'})).status,202);
  for(let n=0;n<100;n++){completed=await(await call(path)).json();if(completed.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.deepEqual(completed.outputs.map(item=>item.version).sort(),['BLACK','ORIGINAL'],JSON.stringify(completed));
  await stored.updateGeneration({id:'alice'},task.id,current=>({...current,status:'running',stages:{...current.stages,'GOLD FOIL':{stage:'generating'}}}));
  const interrupted=await(await call(path)).json();assert.equal(interrupted.status,'interrupted');assert.equal(interrupted.outputs.length,2);assert.match(interrupted.stages['GOLD FOIL'].error,/服务重启/);
  const legacy=await stored.createTask({id:'alice'},{title:'升级前任务'});
  await stored.save({id:'alice'},{taskId:legacy.id,kind:'AI上样',images:[{label:'ORIGINAL',bytes:image}]});
  assert.equal((await call('/api/ai-render',{...input,taskId:legacy.id,onlyVersion:'BLACK'})).status,202);
  for(let n=0;n<100;n++){completed=await(await call(`/api/my-space/tasks/${legacy.id}/generation`)).json();if(completed.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.deepEqual(completed.outputs.map(item=>item.version).sort(),['BLACK','ORIGINAL']);
  assert.deepEqual(Object.keys(completed.stages).sort(),['BLACK','ORIGINAL']);
 }finally{release();releaseFinish();if(server?.listening)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
