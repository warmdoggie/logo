import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createStore} from './store.mjs';

const database=process.env.TEST_DATABASE_URL||'postgres://scheduler:test-only@127.0.0.1:55433/scheduler_test';
assert.equal(new URL(database).pathname,'/scheduler_test','Dedicated disposable test database required');
const pool=new pg.Pool({connectionString:database});
test.after(()=>pool.end());
await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
const store=createStore(pool,{maxRunning:3,userRunning:2,maxPending:20,leaseMs:30000});
const request=(user,requestId=randomUUID(),params={prompt:'test'})=>store.create(user,requestId,params);
async function reset(){await pool.query('TRUNCATE job_events,jobs,business_batches,scheduler_users; UPDATE scheduler_account SET sequence=0');}

test('a durable business batch cannot dispatch until every image is committed',async()=>{
 await reset();assert.equal(typeof store.beginBatch,'function','business batches must be durable');
 const id=randomUUID(),descriptor={taskId:'task-1',generation:{id},items:[{key:'BLACK'},{key:'ORIGINAL'}]};
 await store.beginBatch('alice',id,descriptor);
 await store.create('alice',randomUUID(),{batchId:id,key:'BLACK',prompt:'test'});
 assert.equal(await store.reserve(),null);
 await assert.rejects(store.commitBatch('alice',id),{status:409});
 await store.create('alice',randomUUID(),{batchId:id,key:'ORIGINAL',prompt:'test'});
 assert.equal(await store.batch('bob',id),null);
 await store.commitBatch('alice',id);
 const recovered=createStore(pool);
 assert.equal((await recovered.batch('alice',id)).jobs.length,2);
 assert.equal((await store.reserve()).user_id,'alice');
});

test('ongoing remote generations do not block later submissions by default',async()=>{
 await reset();const expanded=createStore(pool);
 for(let n=0;n<40;n++)await expanded.create('alice',randomUUID(),{prompt:'test'});
 for(let n=0;n<20;n++){
  const job=await expanded.reserve({submitConcurrency:2});assert.ok(job,'submission must not wait for image completion');
  await expanded.transition(job,'GENERATING',{provider_task_id:'ongoing-'+n});
 }
 await expanded.create('bob',randomUUID(),{prompt:'arrived later'});
 const bob=await expanded.reserve({submitConcurrency:2});assert.equal(bob.user_id,'bob');
 await expanded.transition(bob,'GENERATING',{provider_task_id:'bob-ongoing'});
 await expanded.create('carol',randomUUID(),{prompt:'arrived next'});
 assert.equal((await expanded.reserve({submitConcurrency:2})).user_id,'carol');
 assert.equal((await pool.query("SELECT count(*)::int n FROM jobs WHERE status='GENERATING'")).rows[0].n,21);
});

test('retrying a failed download reuses its result and never reserves another generation slot',async()=>{
 await reset();const old=await store.create('alice',randomUUID(),{planHash:'same'});
 await pool.query("UPDATE jobs SET status='DOWNLOAD_FAILED',source_url='https://images.getapib.org/saved.png',provider_task_id='saved-remote' WHERE id=$1",[old.id]);
 const resumed=await store.create('alice',randomUUID(),{planHash:'same',resumeJobId:old.id});
 assert.equal(resumed.status,'REMOTE_SUCCEEDED');assert.equal(resumed.source_url,'https://images.getapib.org/saved.png');
 assert.equal(await store.reserve(),null);assert.equal((await store.claim('download')).id,resumed.id);
});

test('slow image processing cannot accumulate leases for work that has not started',async()=>{
 await reset();for(let n=0;n<10;n++)await store.create('alice',randomUUID(),{prompt:'fixture'});
 await pool.query("UPDATE jobs SET status='DOWNLOADED'");
 const claimed=(await Promise.all(Array.from({length:10},()=>store.claim('process')))).filter(Boolean);
 assert.equal(claimed.length,1);
});

test('HTTP submission permits are released while remote generations continue running',async()=>{
 await reset();const expanded=createStore(pool);
 for(let n=0;n<20;n++)await expanded.create('user-'+n,randomUUID(),{prompt:'fixture'});
 const first=await expanded.reserve({submitConcurrency:2}),second=await expanded.reserve({submitConcurrency:2});
 assert.ok(first&&second);assert.equal(await expanded.reserve({submitConcurrency:2}),null);
 await expanded.transition(first,'GENERATING',{provider_task_id:'ongoing'});
 assert.ok(await expanded.reserve({submitConcurrency:2}));
 assert.equal((await expanded.get(first.user_id,first.id)).slot_reserved,true);
});

test('background recovery pages past one hundred waiting batches',async()=>{
 await reset();
 for(let n=0;n<101;n++){const id=randomUUID();await store.beginBatch('alice',id,{taskId:'page-'+n,generation:{id},items:[{key:'BLACK'}]});}
 const first=await store.activeBatches(),last=await store.activeBatches(first.at(-1).id);
 assert.equal(first.length,100);assert.equal(last.length,1);assert.equal(new Set([...first,...last].map(batch=>batch.id)).size,101);
});

test('accepted jobs persist, duplicate clicks reuse one job, changed payload conflicts',async()=>{
 await reset();const key=randomUUID();
 const results=await Promise.all(Array.from({length:8},()=>request('alice',key)));
 assert.equal(new Set(results.map(j=>j.id)).size,1);
 await assert.rejects(request('alice',key,{prompt:'changed'}),{status:409});
 assert.equal((await store.get('bob',results[0].id)),null);
 assert.equal((await store.get('alice',results[0].id)).status,'QUEUED');
});
test('fifteen users receive a turn before any user receives a second turn',async()=>{
 await reset();for(let u=0;u<15;u++)for(let j=0;j<2;j++)await request('user-'+u);
 const first=[];
 for(let n=0;n<15;n++){
  const claimed=await store.reserve();first.push(claimed.user_id);
  await store.transition(claimed,'GENERATING',{provider_task_id:'remote-'+n});
  await store.transition(await store.claim('poll'),'REMOTE_SUCCEEDED',{source_url:'https://example.test/image'},true);
 }
 assert.equal(new Set(first).size,15);
});
test('competing dispatchers never exceed the global cap and lone users borrow idle slots',async()=>{
 await reset();for(let n=0;n<8;n++)await request('alice');
 const claims=(await Promise.all(Array.from({length:12},()=>store.reserve()))).filter(Boolean);
 assert.equal(claims.length,3);
 assert.equal((await pool.query('SELECT count(*)::int n FROM jobs WHERE slot_reserved')).rows[0].n,3);
 await request('bob');
 await store.transition(claims[0],'FAILED',{},true);
 assert.equal((await store.reserve()).user_id,'bob');
});
test('uncertain submit keeps its slot; a crash before the HTTP call safely requeues',async()=>{
 await reset();await request('alice');await request('bob');
 const a=await store.reserve(),b=await store.reserve();await store.startSubmit(a);
 await pool.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=ANY($1::uuid[])",[[a.id,b.id]]);
 await store.recover();
 assert.equal((await store.get('alice',a.id)).status,'SUBMISSION_UNKNOWN');
 assert.equal((await store.get('alice',a.id)).slot_reserved,true);
 assert.equal((await store.get('bob',b.id)).status,'QUEUED');
 assert.equal((await store.get('bob',b.id)).slot_reserved,false);
 assert.equal(await store.startSubmit(b),null);
});
test('remote completion releases once; download failure resumes download without generating',async()=>{
 await reset();await request('alice');const job=await store.reserve();
 await store.transition(job,'GENERATING',{provider_task_id:'known'});
 await store.transition(await store.claim('poll'),'REMOTE_SUCCEEDED',{source_url:'https://example.test/image'},true);
 const download=await store.claim('download');assert.equal(download.id,job.id);
 await store.retry(download,'REMOTE_SUCCEEDED','download_network',0);
 assert.equal((await store.claim('download')).id,job.id);
 assert.equal(await store.reserve(),null);
 assert.equal((await store.get('alice',job.id)).provider_task_id,'known');
 await store.transition(job,'FAILED',{},true);
 assert.equal((await pool.query('SELECT count(*)::int n FROM jobs WHERE slot_reserved')).rows[0].n,0);
});
test('lease fencing rejects a stale worker and expired polling retains the remote slot',async()=>{
 await reset();await request('alice');const job=await store.reserve();await store.transition(job,'GENERATING',{provider_task_id:'known'});
 const poll=await store.claim('poll');
 await pool.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[job.id]);
 await store.recover();
 assert.equal(await store.transition(poll,'FAILED',{},true),null);
 const current=await store.get('alice',job.id);assert.equal(current.status,'GENERATING');assert.equal(current.slot_reserved,true);
 assert.ok(await store.claim('poll'));
});
test('pending quota is atomic and cancelled queued jobs do not consume quota',async()=>{
 await reset();const results=await Promise.allSettled(Array.from({length:25},()=>request('alice')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,20);
 assert.equal(results.filter(r=>r.reason?.status===429).length,5);
 const job=results.find(r=>r.status==='fulfilled').value;assert.equal(await store.cancel('bob',job.id),null);
 assert.equal((await store.cancel('alice',job.id)).status,'CANCELLED');await request('alice');
});
test('exhausted downloads do not permanently consume pending quota',async()=>{
 await reset();for(let n=0;n<20;n++)await request('alice');
 const job=await store.reserve();await store.transition(job,'DOWNLOAD_FAILED',{error_code:'remote_result_missing'},true);
 await request('alice');
});
test('disk pause preserves download budget and source task',async()=>{
 await reset();await request('alice');const job=await store.reserve();
 await store.transition(job,'REMOTE_SUCCEEDED',{source_url:'https://example.test/image'},true);
 const download=await store.claim('download');await store.pauseDownload(download);
 const paused=await store.get('alice',job.id);assert.equal(paused.status,'REMOTE_SUCCEEDED');assert.equal(paused.download_attempts,0);assert.equal(paused.source_url,'https://example.test/image');
});
