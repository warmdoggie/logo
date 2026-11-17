import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import * as plans from './plans.mjs';

const value={request:{prompt:'fixture',image_urls:['data:image/png;base64,AAAA']},maskImage:'data:image/png;base64,BBBB'};
const bytes=Buffer.from(JSON.stringify(value)),hash=createHash('sha256').update(bytes).digest('hex');
test('new OSS plans can be read after process replacement without leaving large local files',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'scheduler-cloud-plans-')),objects=new Map();
 try{
  assert.equal(typeof plans.writePlan,'function','business uploads need durable plan storage');
  const storage={async publish(key,data){objects.set(key,Buffer.from(data));},async read(key){return objects.get(key);}};
  assert.equal(await plans.writePlan(directory,bytes,{storage}),hash);
  assert.deepEqual(await readdir(directory),[],'cloud persistence must not accumulate raw JSON');
  assert.deepEqual(await plans.readPlan(directory,hash,{storage:{read:async key=>objects.get(key)}}),value);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('legacy local plans remain readable without contacting OSS',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'scheduler-legacy-plans-'));
 try{
  await mkdir(join(directory,'plans'));await writeFile(join(directory,'plans',hash+'.json'),bytes);
  assert.deepEqual(await plans.readPlan(directory,hash,{storage:{read:async()=>{throw Error('cloud unavailable');}}}),value);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('failed OSS writes do not fall back to unlimited local persistence',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'scheduler-plan-outage-'));
 try{
  assert.equal(typeof plans.writePlan,'function');
  await assert.rejects(plans.writePlan(directory,bytes,{storage:{publish:async()=>{throw Error('offline');}}}),/offline/);
  assert.deepEqual(await readdir(directory),[]);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('local mode still fsyncs a plan that can be loaded after restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'scheduler-local-plan-'));
 try{
  assert.equal(typeof plans.writePlan,'function');
  assert.equal(await plans.writePlan(directory,bytes,{storage:null}),hash);
  assert.deepEqual(await readFile(join(directory,'plans',hash+'.json')),bytes);
  assert.deepEqual(await plans.readPlan(directory,hash,{storage:null}),value);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('a corrupt local plan cannot silently use another cloud copy',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'scheduler-corrupt-plan-'));
 try{
  await mkdir(join(directory,'plans'));await writeFile(join(directory,'plans',hash+'.json'),'{}');
  await assert.rejects(plans.readPlan(directory,hash,{storage:{read:async()=>bytes}}),/checksum/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('missing cloud data is identified as unavailable before a paid submission',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'scheduler-missing-plan-'));
 try{
  await assert.rejects(plans.readPlan(directory,hash,{storage:{read:async()=>{throw Error('OSS offline');}}}),error=>error.planUnavailable===true);
 }finally{await rm(directory,{recursive:true,force:true});}
});
