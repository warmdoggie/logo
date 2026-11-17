import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {Readable} from 'node:stream';

test('snapshot and isolated restore keep referenced OSS plans readable after local eviction',async()=>{
 const {uploadDataSnapshot,restoreDataSnapshot}=await import('./logo-data-snapshot.mjs');
 const {createPlanStorage}=await import('./logo-plan-storage.mjs');
 const {readPlan}=await import('./generation-scheduler/plans.mjs');
 const root=await mkdtemp(join(tmpdir(),'logo-cloud-plan-snapshot-')),objects=new Map();
 const bytes=Buffer.from('{"request":{"prompt":"preserve original images"}}'),hash=createHash('sha256').update(bytes).digest('hex');
 const remote={async head(key){if(!objects.has(key))throw Object.assign(Error('missing'),{status:404});},async put(key,bytes){objects.set(key,Buffer.from(bytes));},async putStream(key,source){const chunks=[];for await(const part of source)chunks.push(part);objects.set(key,Buffer.concat(chunks));},async getStream(key){if(!objects.has(key))throw Object.assign(Error('missing'),{status:404});return {stream:Readable.from([objects.get(key)])};}};
 try{
  const workspace=join(root,'workspace');await mkdir(workspace);await writeFile(join(workspace,'task.json'),'{}');
  objects.set('s7-logo/scheduler-backups/v1/plans/'+hash+'.json.gz',gzipSync(bytes));
  const manifest=await uploadDataSnapshot({roots:{workspace},stamp:'20261104T010000Z',planHashes:[hash],client:async()=>remote});
  assert.deepEqual(manifest.remotePlans.map(plan=>plan.hash),[hash]);
  await restoreDataSnapshot({manifest,roots:{workspace:join(root,'restored')},client:async()=>remote});
  assert.deepEqual(await readPlan(root,hash,{storage:createPlanStorage({client:async()=>remote})}),JSON.parse(bytes));
  objects.delete('s7-logo/scheduler-backups/v1/plans/'+hash+'.json.gz');
  await assert.rejects(uploadDataSnapshot({roots:{workspace},stamp:'20261104T010001Z',planHashes:[hash],client:async()=>remote}),/plan/i);
  assert.equal(objects.has('s7-logo/scheduler-backups/v1/snapshots/20261104T010001Z/manifest.json'),false);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('data snapshots deduplicate immutable blobs and verify archived plan closure before completion',async()=>{
 const {uploadDataSnapshot,restoreDataSnapshot}=await import('./logo-data-snapshot.mjs');
 const root=await mkdtemp(join(tmpdir(),'logo-snapshot-')),objects=new Map();
 let puts=0;
 const remote={async head(key){if(!objects.has(key)){const e=Error('missing');e.status=404;throw e;}return {};},async put(key,input){objects.set(key,Buffer.isBuffer(input)?input:await readFile(input));puts++;},async getStream(key){if(!objects.has(key))throw Error('missing');return {stream:Readable.from([objects.get(key)])};}};
 remote.putStream=async(key,input)=>{const chunks=[];for await(const chunk of input)chunks.push(chunk);objects.set(key,Buffer.concat(chunks));puts++;};
 const raw=Buffer.from('{"plan":"preserved original pixels"}'),hash=createHash('sha256').update(raw).digest('hex');
 try{
  for(const folder of ['plans','workspace'])await mkdir(join(root,folder));
  await writeFile(join(root,'plans',hash+'.json.gz'),gzipSync(raw));
  await writeFile(join(root,'workspace','task.json'),'{"customer":"客户"}');
  const roots={archives:join(root,'plans'),workspace:join(root,'workspace')};
  const manifest=await uploadDataSnapshot({roots,stamp:'20261102T010000Z',planHashes:[hash],client:async()=>remote});
  assert.equal(manifest.files.length,2);assert.equal(manifest.planHashes[0],hash);
  const previousPuts=puts;
  await uploadDataSnapshot({roots,stamp:'20261102T010001Z',planHashes:[hash],client:async()=>remote});
  assert.equal(puts,previousPuts+1,'unchanged data must reuse content-addressed cloud blobs');
  await restoreDataSnapshot({manifest,roots:{archives:join(root,'restored-plans'),workspace:join(root,'restored-workspace')},client:async()=>remote});
  assert.deepEqual(await readFile(join(root,'restored-plans',hash+'.json.gz')),gzipSync(raw));
  assert.equal(await readFile(join(root,'restored-workspace','task.json'),'utf8'),'{"customer":"客户"}');
  await assert.rejects(uploadDataSnapshot({roots,stamp:'20261102T010002Z',planHashes:['a'.repeat(64)],client:async()=>remote}),/plan/i);
  assert.equal(objects.has('s7-logo/scheduler-backups/v1/snapshots/20261102T010002Z/manifest.json'),false);
  const entry=manifest.files[0];objects.set(entry.key,Buffer.from('corruption'));
  await assert.rejects(restoreDataSnapshot({manifest,roots:{archives:join(root,'bad-plans'),workspace:join(root,'bad-workspace')},client:async()=>remote}),/checksum/i);
  await uploadDataSnapshot({roots,stamp:'20261102T010003Z',planHashes:[hash],client:async()=>remote});
  assert.deepEqual(objects.get(entry.key),await readFile(join(roots[entry.root],entry.path)),'a damaged existing blob must be repaired');
  await assert.rejects(restoreDataSnapshot({manifest:{...manifest,files:[{...entry,path:'../escape'}]},roots:{archives:join(root,'escape-plans'),workspace:join(root,'escape-workspace')},client:async()=>remote}),/Unsafe/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('atomic replacement between hashing and upload cannot poison an immutable object key',{skip:process.platform==='win32'?'Requires POSIX rename of an open file':false},async()=>{
 const {uploadDataSnapshot}=await import('./logo-data-snapshot.mjs'),root=await mkdtemp(join(tmpdir(),'logo-snapshot-fd-')),objects=new Map(),old=Buffer.from('old immutable snapshot bytes');
 const file=join(root,'task.json');
 try{
  await writeFile(file,old);let replaced=false;
  const remote={async head(){if(!replaced){replaced=true;await writeFile(file+'.new','new task data');await rename(file+'.new',file);}const error=Error();error.status=404;throw error;},async putStream(key,input){const chunks=[];for await(const chunk of input)chunks.push(chunk);objects.set(key,Buffer.concat(chunks));},async getStream(key){return {stream:Readable.from([objects.get(key)])};}};
  await assert.rejects(uploadDataSnapshot({roots:{workspace:root},stamp:'20261102T010006Z',client:async()=>remote}),/changed/);
  assert.deepEqual(objects.get('s7-logo/scheduler-backups/v1/blobs/'+createHash('sha256').update(old).digest('hex')),old);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a concurrent workspace change blocks the completion manifest',async()=>{
 const {uploadDataSnapshot}=await import('./logo-data-snapshot.mjs'),root=await mkdtemp(join(tmpdir(),'logo-snapshot-race-')),objects=new Map();
 try{
  await mkdir(join(root,'assets'));await writeFile(join(root,'assets','old.png'),'old');await writeFile(join(root,'task.json'),'{"asset":"assets/old.png"}');
  let changed=false;
  const remote={async head(){const error=Error();error.status=404;throw error;},async put(key,input){objects.set(key,Buffer.isBuffer(input)?input:await readFile(input));if(!changed){changed=true;await writeFile(join(root,'assets','new.png'),'new');await writeFile(join(root,'task.json'),'{"asset":"assets/new.png"}');}},async getStream(key){return {stream:Readable.from([objects.get(key)])};}};
  remote.putStream=async(key,input)=>{const chunks=[];for await(const chunk of input)chunks.push(chunk);await remote.put(key,Buffer.concat(chunks));};
  await assert.rejects(uploadDataSnapshot({roots:{workspace:root},stamp:'20261102T010005Z',client:async()=>remote}),/changed/);
  assert.equal(objects.has('s7-logo/scheduler-backups/v1/snapshots/20261102T010005Z/manifest.json'),false);
 }finally{await rm(root,{recursive:true,force:true});}
});
