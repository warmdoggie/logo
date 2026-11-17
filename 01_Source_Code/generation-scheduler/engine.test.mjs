import test from 'node:test';
import assert from 'node:assert/strict';
import {runStage} from './engine.mjs';

test('a local silver image goes straight to image processing without a provider submission',async()=>{
 let submitted=0,result;
 const job={id:'local',params:{local:true}};
 await runStage('submit',job,{store:{startSubmit:async()=>job,transition:async(...args)=>{result=args;}},provider:{submit:async()=>{submitted++;return {taskId:'unexpected'};}}});
 assert.equal(submitted,0);assert.equal(result[1],'DOWNLOADED');assert.equal(result[3],true);
});

test('turning paid generation off also blocks submit jobs already waiting in Redis',async()=>{
 let submitted=0,deferred=0;
 await runStage('submit',{id:'waiting',params:{}},{allowRemote:false,store:{deferSubmit:async()=>{deferred++;},startSubmit:async job=>job,transition:async()=>{}},provider:{submit:async()=>{submitted++;return {taskId:'unexpected'};}}});
 assert.equal(submitted,0);assert.equal(deferred,1);
});

function fixture(){
 const changes=[];return {changes,store:{startSubmit:async j=>j,transition:async(...args)=>changes.push(args),retry:async(...args)=>changes.push(args),pausePlanRead:async job=>changes.push([job,'DOWNLOADED','plan_storage_unavailable',60000])}};
}
test('OSS outages keep retrying only storage and never exhaust successful image processing',async()=>{
 const {changes,store}=fixture();await runStage('process',{id:'job',process_attempts:30},{store,processImage:async()=>{throw Object.assign(Error('upload failed'),{code:'STORAGE_PENDING'});}});
 assert.equal(changes[0][1],'DOWNLOADED');assert.equal(changes[0][2],'storage_pending');assert.equal(changes[0][3],60000);
});
test('lost submit acknowledgement never retries generation and keeps the slot',async()=>{
 const {changes,store}=fixture();await runStage('submit',{id:'job'}, {store,provider:{submit:async()=>{throw Error('timeout');}}});
 assert.equal(changes[0][1],'SUBMISSION_UNKNOWN');assert.equal(changes[0][3],false);
});
test('an unavailable plan retries preparation without treating it as an uncertain paid POST',async()=>{
 const {changes,store}=fixture();await runStage('submit',{id:'job'}, {store,provider:{submit:async()=>{throw Object.assign(Error('plan unavailable'),{planUnavailable:true});}}});
 assert.equal(changes[0][1],'QUEUED');assert.equal(changes[0][2].error_code,'plan_storage_unavailable');assert.equal(changes[0][3],true);assert.equal(changes[0][4],60000);
});
test('plan retrieval completes before marking any paid submission as started',async()=>{
 const events=[],job={id:'job',params:{batchId:'fixture'}};
 await runStage('submit',job,{store:{startSubmit:async()=>{events.push('started');return job;},transition:async()=>{}},provider:{prepare:async()=>{events.push('prepared');return {prompt:'original'};},submit:async(params,input)=>{assert.deepEqual(input,{prompt:'original'});events.push('posted');return {taskId:'remote'};}}});
 assert.deepEqual(events,['prepared','started','posted']);
});
test('a failed preparation never sets the paid submission marker',async()=>{
 const events=[];
 await runStage('submit',{id:'job',params:{}},{store:{startSubmit:async()=>events.push('started'),transition:async(job,status,patch,release,delay)=>events.push({status,release,delay})},provider:{prepare:async()=>{throw Error('cloud offline');},submit:async()=>events.push('posted')}});
 assert.deepEqual(events,[{status:'QUEUED',release:true,delay:60000}]);
});
test('a temporary plan read outage does not exhaust finished image processing',async()=>{
 const {changes,store}=fixture();await runStage('process',{id:'job',process_attempts:30},{store,processImage:async()=>{throw Object.assign(Error('plan unavailable'),{planUnavailable:true});}});
 assert.equal(changes[0][1],'DOWNLOADED');assert.equal(changes[0][2],'plan_storage_unavailable');assert.equal(changes[0][3],60000);
});
test('confirmed rejection releases the slot',async()=>{
 const {changes,store}=fixture();await runStage('submit',{id:'job'}, {store,provider:{submit:async()=>{throw Object.assign(Error(),{rejected:true});}}});
 assert.equal(changes[0][1],'FAILED');assert.equal(changes[0][3],true);
});
test('polling network failure retains task identity and slot',async()=>{
 const {changes,store}=fixture();const job={id:'job',provider_task_id:'remote'};
 await runStage('poll',job,{store,provider:{poll:async()=>{throw Error('timeout');}},pollMs:1});
 assert.equal(changes[0][1],'GENERATING');assert.equal(changes[0][0].provider_task_id,'remote');
});
test('download errors retry download; exhausted retries keep remote success visible',async()=>{
 for(const [attempts,status] of [[1,'REMOTE_SUCCEEDED'],[8,'DOWNLOAD_FAILED']]){
  const {changes,store}=fixture();await runStage('download',{id:'job',download_attempts:attempts},{store,provider:{download:async()=>{throw Error();}}});
  assert.equal(changes[0][1],status);
 }
});
test('remote success releases generation capacity before downloading',async()=>{
 const {changes,store}=fixture();await runStage('poll',{id:'job'},{store,provider:{poll:async()=>({status:'completed',url:'https://image.test/file'})}});
 assert.equal(changes[0][1],'REMOTE_SUCCEEDED');assert.equal(changes[0][3],true);
});
test('confirmed completion with a missing URL releases the slot and flags retrieval failure',async()=>{
 const {changes,store}=fixture();await runStage('poll',{id:'job'},{store,provider:{poll:async()=>({status:'completed'})}});
 assert.equal(changes[0][1],'DOWNLOAD_FAILED');assert.equal(changes[0][2].error_code,'remote_result_missing');assert.equal(changes[0][3],true);
});
test('disk pause defers download without spending a retry',async()=>{
 const calls=[],store={pauseDownload:async job=>calls.push(job.id)};
 await runStage('download',{id:'job',download_attempts:8},{store,provider:{download:async()=>{throw Object.assign(Error(),{code:'DISK_SPACE'});}}});
 assert.deepEqual(calls,['job']);
});
