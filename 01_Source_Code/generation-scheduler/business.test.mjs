import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import sharp from 'sharp';
import {userSpace} from '../s7-logo-stability/user-space.mjs';
import {createStore} from './store.mjs';
import {createDemoServer} from '../s7-logo-stability/demo-server.mjs';
import {buildAiMockupPlan} from '../s7-logo-stability/ai-mockup-generation.mjs';

test('single, multi-product and multi-logo batches survive the page process and project history once',async()=>{
 const source=new URL('../s7-logo-stability/scheduled-generation.mjs',import.meta.url);
 let module;try{module=await import(source.href);}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
 assert.ok(module?.createScheduledGenerations,'business entries need a durable scheduling adapter');
 const database=process.env.BUSINESS_TEST_DATABASE_URL||'postgres://scheduler:test-only@127.0.0.1:55433/scheduler_acceptance';
 assert.equal(new URL(database).pathname,'/scheduler_acceptance');
 const pool=new pg.Pool({connectionString:database});
 const folder=await mkdtemp(join(tmpdir(),'scheduler-business-')),token=randomUUID()+randomUUID(),port=3322;
 let child,web;
 try{
  await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
  await pool.query('TRUNCATE job_events,jobs,business_batches,scheduler_users');
  const config=join(folder,'provider.json');await writeFile(config,JSON.stringify({provider:'APIMART',endpoint:'https://api.apimart.ai',model:'gpt-image-2',apiKey:'test-never-sent'}));
  child=spawn(process.execPath,[fileURLToPath(new URL('./api.mjs',import.meta.url))],{env:{...process.env,DATABASE_URL:database,REDIS_URL:process.env.BUSINESS_TEST_REDIS_URL||'redis://127.0.0.1:56380',SCHEDULER_TOKEN:token,PROVIDER_ENABLED:'false',RESULT_DIRECTORY:folder,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  for(let i=0;i<100&&!output.includes('scheduler_api_ready');i++)await delay(50);
  assert.ok(output.includes('scheduler_api_ready'),output);
  const spaces=userSpace(join(folder,'spaces')),options={spaces,url:'http://127.0.0.1:'+port,token,configPath:config,autoStart:false};
  const service=module.createScheduledGenerations(options),user={id:'alice'},store=createStore(pool);
  const bytes=await sharp({create:{width:32,height:32,channels:4,background:'#ffffff'}}).png().toBuffer(),image='data:image/png;base64,'+bytes.toString('base64');
  const input={baseImage:image,logoImage:image,originalColor:'#000000',model:'gpt-image-2',selectedVersions:['BLACK'],targets:[{id:'front',x:4,y:4,width:10,height:10}],guides:[{version:'BLACK',dataUrl:image}],size:'1:1'};
  const batches=[];
  for(const [kind,extra] of [[undefined,{}],['multi-product',{productId:'p1'}],['multi-logo',{logoId:'l1',logoName:'Logo A'}]]){
   const task=await spaces.createTask(user,{title:kind||'single'});
   const record=await service.start(user,task.id,{kind,model:'gpt-image-2',outputs:[]},[{input,output:extra,label:'fixture'}]);
   assert.equal(record.status,'running');assert.equal(record.scheduler,true);
   const batch=await store.batch(user.id,record.id);assert.equal(batch.status,'READY');assert.equal(batch.jobs.length,1);
   assert.equal(batch.jobs[0].status,'QUEUED','disabled provider must not make a paid request');batches.push({task,record,batch,extra});
  }
  const restarted=module.createScheduledGenerations(options);
  const legacy=await spaces.createTask(user,{title:'legacy remote resume'}),plan=buildAiMockupPlan(input)[0];
  const requestHash=createHash('sha256').update(JSON.stringify(['https://api.apimart.ai','test-never-sent',plan])).digest('hex');
  await spaces.updateGeneration(user,legacy.id,()=>({id:randomUUID(),status:'interrupted',outputs:[],remoteTasks:{BLACK:{requestHash,taskId:'legacy-remote'}},stages:{BLACK:{stage:'failed'}}}));
  const adopted=await service.start(user,legacy.id,{model:'gpt-image-2',outputs:[]},[{input}]);
  const adoptedJob=(await store.batch(user.id,adopted.id)).jobs[0];
  assert.equal(adoptedJob.status,'GENERATING');assert.equal(adoptedJob.provider_task_id,'legacy-remote');
  for(const {task,record,batch,extra} of batches){
   assert.equal(await store.batch('bob',record.id),null);
   await pool.query("UPDATE jobs SET status='SUCCEEDED',result_path=$2 WHERE id=$1",[batch.jobs[0].id,join(folder,batch.jobs[0].id+'.png')]);
   await writeFile(join(folder,batch.jobs[0].id+'.png'),bytes);
   const recovered=await restarted.read(user,task.id);
   assert.equal(recovered.status,'complete');assert.equal(recovered.outputs.length,1);
   for(const [key,value] of Object.entries(extra))assert.equal(recovered.outputs[0][key],value);
   const again=module.createScheduledGenerations(options);await again.read(user,task.id);
   assert.equal((await spaces.history(user,task.id)).length,1,'recovery must not duplicate history');
   await assert.rejects(restarted.read({id:'bob'},task.id),{status:404});
  }
  const orphan=await spaces.createTask(user,{title:'restart during upload'}),orphanId=randomUUID();
  const descriptor={taskId:orphan.id,generation:{id:orphanId,model:'gpt-image-2',outputs:[],stages:{BLACK:{stage:'queued'}},createdAt:new Date().toISOString()},items:[{key:'BLACK',version:'BLACK',label:'BLACK'}]};
  await store.beginBatch(user.id,orphanId,descriptor);
  await pool.query("UPDATE business_batches SET created_at=now()-interval '11 minutes' WHERE id=$1",[orphanId]);
  await restarted.refresh();assert.equal((await store.batch(user.id,orphanId)).status,'ABORTED');
  assert.equal((await spaces.generation(user,orphan.id)).status,'failed');
  await store.beginBatch(user.id,randomUUID(),{...descriptor,generation:{...descriptor.generation,id:randomUUID()}});
  const deleted=await spaces.createTask(user,{title:'deleted before commit'}),deletedId=randomUUID();
  await store.beginBatch(user.id,deletedId,{...descriptor,taskId:deleted.id,generation:{...descriptor.generation,id:deletedId}});
  const cancelled=await store.create(user.id,randomUUID(),{batchId:deletedId,key:'BLACK',planHash:'test-fixture'});
  await spaces.deleteTask(user,deleted.id);await restarted.refresh();
  assert.equal((await store.batch(user.id,deletedId)).status,'ABORTED');
  assert.equal((await store.get(user.id,cancelled.id)).status,'CANCELLED','a removed task must not become a paid generation');
  const products=['p1','p2'].map(id=>({id,sku:id,name:id,imageBytes:bytes,template:{zones:[{id:'front',zoneType:'logo',x:.3,y:.3,width:.2,height:.1}]}}));
  const mark=await sharp({create:{width:4,height:2,channels:4,background:'#ff0000'}}).png().toBuffer();
  const logo=await sharp({create:{width:8,height:6,channels:4,background:'#00000000'}}).composite([{input:mark,left:2,top:2}]).png().toBuffer();
  web=createDemoServer({spaceDir:join(folder,'spaces'),authenticate:async()=>user,productCatalog:async()=>products,schedulerOptions:{...options,spaces:undefined},mockupRenderer:async()=>{throw Error('legacy paid renderer must never be called');}});
  await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));
  for(const [path,extra,expected] of [['/api/ai-render',{baseImage:bytes.toString('base64'),targets:[{id:'front',x:.5,y:.5,widthRatio:.2}]},1],['/api/ai-render-multi',{productIds:['p1','p2']},2],['/api/ai-render-logos',{productId:'p1',logos:[{id:'l1',name:'A',logoImage:logo.toString('base64')},{id:'l2',name:'B',logoImage:logo.toString('base64')}]},2]]){
   const task=await spaces.createTask(user,{title:path});
   const response=await fetch(`http://127.0.0.1:${web.address().port}`+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({background:true,taskId:task.id,model:'gpt-image-2',selectedVersions:['BLACK'],logoImage:logo.toString('base64'),...extra})});
   const record=await response.json();assert.equal(response.status,202,JSON.stringify(record));assert.equal(record.scheduler,true,path+' bypassed the queue');
   assert.equal((await store.batch(user.id,record.id)).jobs.length,expected);
  }
 }finally{
  if(web){web.closeAllConnections();await new Promise(resolve=>web.close(resolve));}
  if(child&&!child.killed){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  await pool.end();await rm(folder,{recursive:true,force:true});
 }
});
