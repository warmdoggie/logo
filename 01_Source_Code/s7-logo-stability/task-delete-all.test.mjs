import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {userSpace} from './user-space.mjs';
import {createDemoServer} from './demo-server.mjs';
import {createServer} from 'node:http';
import {businessApi} from '../generation-scheduler/business-api.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'s7-delete-all-')),removed=[];let offline=false;
 const storage={remove:async descriptor=>{if(offline)throw Error('线上存储清理失败');removed.push(descriptor);}},spaces=userSpace(dir,{storage}),alice={id:'alice'},bob={id:'bob'};
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const a=await spaces.createTask(alice,{title:'客户A'}),b=await spaces.createTask(alice,{title:'客户B'}),other=await spaces.createTask(bob,{title:'其他账号'});
 const asset=await spaces.saveTaskAsset(alice,a.id,Buffer.from('source'),'image/png');
 const descriptor={original:'original-key',preview:'preview-key'};
 const result=await spaces.save(alice,{taskId:a.id,kind:'test',images:[{label:'result',bytes:Buffer.from('result'),storage:descriptor}]});
 await spaces.save(bob,{taskId:other.id,kind:'test',images:[{label:'other',bytes:Buffer.from('other'),storage:{original:'other-original',preview:'other-preview'}}]});
 return {dir,spaces,alice,bob,a,b,other,asset,result,descriptor,removed,storage,setOffline:value=>{offline=value;}};
}

test('delete all removes every owned task, snapshot and online result while preserving other users',async t=>{
 const f=await fixture(t);assert.equal(typeof f.spaces.deleteAllTasks,'function');
 assert.deepEqual(await f.spaces.deleteAllTasks(f.alice),{deleted:2});
 assert.deepEqual(await f.spaces.tasks(f.alice),[]);assert.deepEqual(f.removed,[f.descriptor]);
 await assert.rejects(stat(join(f.dir,'alice',f.result.id)),{code:'ENOENT'});
 await assert.rejects(f.spaces.taskAssetFromUrl(f.alice,f.a.id,f.asset),{status:404});
 assert.equal((await f.spaces.tasks(f.bob)).length,1);assert.equal((await f.spaces.history(f.bob,f.other.id)).length,1);
 assert.deepEqual(await f.spaces.deleteAllTasks(f.alice),{deleted:0});
});

test('online cleanup failure preserves deletion metadata and allows a later retry',async t=>{
 const f=await fixture(t);assert.equal(typeof f.spaces.deleteAllTasks,'function');f.setOffline(true);
 await assert.rejects(f.spaces.deleteAllTasks(f.alice),/线上存储/);
 assert.equal((await f.spaces.tasks(f.alice)).length,2);assert.equal((await f.spaces.history(f.alice,f.a.id)).length,1);
 f.setOffline(false);await f.spaces.deleteAllTasks(f.alice);assert.deepEqual(f.removed,[f.descriptor]);
});

test('a running task prevents bulk deletion before any local or remote content is removed',async t=>{
 const f=await fixture(t);assert.equal(typeof f.spaces.deleteAllTasks,'function');
 await f.spaces.updateGeneration(f.alice,f.b.id,()=>({status:'running'}));
 await assert.rejects(f.spaces.deleteAllTasks(f.alice),{status:409});
 assert.equal((await f.spaces.tasks(f.alice)).length,2);assert.equal(f.removed.length,0);
});

test('bulk delete API requires confirmation and is scoped to the signed-in account',async t=>{
 const f=await fixture(t),server=createDemoServer({spaceDir:f.dir,generationStorage:f.storage,authenticate:async req=>({id:req.headers.cookie||'alice'})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const call=(body,user='alice')=>fetch(`http://127.0.0.1:${server.address().port}/api/my-space/tasks`,{method:'DELETE',headers:{cookie:user,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await call({})).status,400);assert.equal((await f.spaces.tasks(f.alice)).length,2);
 const response=await call({confirmAll:true});assert.equal(response.status,200);assert.deepEqual(await response.json(),{deleted:2});
 assert.equal((await f.spaces.tasks(f.bob)).length,1);assert.deepEqual(f.removed,[f.descriptor]);
});

test('bulk cleanup blocks new task writes and duplicate deletion while online objects are being removed',async t=>{
 const f=await fixture(t);let release,entered;const pending=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 f.storage.remove=async()=>{entered();await pending;};
 const server=createDemoServer({spaceDir:f.dir,generationStorage:f.storage,authenticate:async()=>f.alice});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const call=(data,method)=>fetch(`http://127.0.0.1:${server.address().port}/api/my-space/tasks`,{method,headers:{'content-type':'application/json'},body:JSON.stringify(data)});
 const deleting=call({confirmAll:true},'DELETE');
 try{await started;assert.equal((await call({title:'不能在清理中创建'},'POST')).status,409);assert.equal((await call({confirmAll:true},'DELETE')).status,409);}
 finally{release();await deleting;}
 assert.deepEqual(await f.spaces.tasks(f.alice),[]);
 assert.equal((await call({title:'清理后新任务'},'POST')).status,201);
});

test('bulk deletion also purges all scheduler history for the current account',async t=>{
 const f=await fixture(t);let purged=false;
 const store={latestBatch:async()=>null,purgeTasks:async(user,ids,cleanup)=>{assert.equal(user,'alice');assert.equal(ids,null);await cleanup({jobs:[],planHashes:[]});purged=true;return {deleted:2};}};
 const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 const scheduler=createServer(async(req,res)=>{assert.equal(req.headers['x-user-id'],'alice');await businessApi(req,res,{store,user:'alice',directory:f.dir,send});});
 await new Promise(resolve=>scheduler.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>scheduler.close(resolve)));
 const server=createDemoServer({spaceDir:f.dir,generationStorage:f.storage,authenticate:async()=>f.alice,schedulerOptions:{url:`http://127.0.0.1:${scheduler.address().port}`,token:'test-only-'.repeat(6),autoStart:false}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/my-space/tasks`,{method:'DELETE',body:JSON.stringify({confirmAll:true})});
 assert.equal(response.status,200);assert.equal(purged,true);assert.deepEqual(await f.spaces.tasks(f.alice),[]);assert.deepEqual(f.removed,[f.descriptor]);
});
