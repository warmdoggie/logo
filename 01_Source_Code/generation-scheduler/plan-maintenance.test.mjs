import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,rename,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {Readable} from 'node:stream';
import {createPlanStorage} from '../logo-plan-storage.mjs';
import {readPlan} from './plans.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'scheduler-plan-migration-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const directory=join(root,'results'),archives=join(root,'archives');await mkdir(join(directory,'plans'),{recursive:true});await mkdir(archives);
 const bytes=Buffer.from('{"request":{"prompt":"immutable original image bytes"}}'),hash=createHash('sha256').update(bytes).digest('hex');
 const raw=join(directory,'plans',hash+'.json'),compressed=join(archives,hash+'.json.gz');await writeFile(raw,bytes);await writeFile(compressed,gzipSync(bytes));
 const objects=new Map(),remote={async put(key,data){objects.set(key,Buffer.from(data));},async getStream(key){if(!objects.has(key))throw Object.assign(Error('missing cloud plan'),{status:404});return {stream:Readable.from([objects.get(key)])};}};
 return {root,directory,archives,bytes,hash,raw,compressed,objects,remote,receiptFile:join(root,'receipt.json'),storage:createPlanStorage({client:async()=>remote})};
}
async function maintenance(){
 const module=await import('./plan-maintenance.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
 assert.equal(typeof module.migratePlans,'function','eviction requires verified cloud migration');return module;
}
test('migration inventory makes no cloud writes or local deletions',async t=>{
 const f=await fixture(t),{migratePlans}=await maintenance();
 const result=await migratePlans({...f});assert.equal(result.files,2);assert.equal(result.plans,1);assert.equal(f.objects.size,0);await access(f.raw);await access(f.compressed);
 await assert.rejects(access(f.receiptFile),{code:'ENOENT'});
});
test('verified migration frees both raw and gzip copies and can restore the old local reader',async t=>{
 const f=await fixture(t),{migratePlans,restorePlans}=await maintenance();
 await migratePlans({...f,mode:'publish'});await access(f.raw);await access(f.compressed);
 const result=await migratePlans({...f,mode:'evict'});assert.equal(result.evicted,2);assert.ok(result.freedBytes>f.bytes.length);
 await assert.rejects(access(f.raw),{code:'ENOENT'});await assert.rejects(access(f.compressed),{code:'ENOENT'});
 assert.deepEqual(await readPlan(f.directory,f.hash,{storage:f.storage}),JSON.parse(f.bytes));
 const receipt=JSON.parse(await readFile(f.receiptFile,'utf8'));assert.deepEqual(Object.keys(receipt.plans),[f.hash]);
 await restorePlans({directory:f.directory,hashes:Object.keys(receipt.plans),storage:f.storage});
 assert.deepEqual(await readFile(f.raw),f.bytes);assert.deepEqual(await readPlan(f.directory,f.hash,{storage:null}),JSON.parse(f.bytes));
});
test('bad cloud readback leaves every original plan intact',async t=>{
 const f=await fixture(t),{migratePlans}=await maintenance();f.remote.put=async key=>f.objects.set(key,gzipSync(Buffer.from('{}')));
 await assert.rejects(migratePlans({...f,mode:'publish'}),/checksum/);assert.deepEqual(await readFile(f.raw),f.bytes);await access(f.compressed);
 await assert.rejects(access(f.receiptFile),{code:'ENOENT'});
});
test('local eviction refuses a missing cloud plan',async t=>{
 const f=await fixture(t),{migratePlans}=await maintenance();await assert.rejects(migratePlans({...f,mode:'evict'}),/missing/);
 await access(f.raw);await access(f.compressed);
});
test('a file replaced during cloud verification is never evicted',async t=>{
 const f=await fixture(t),{migratePlans}=await maintenance();await migratePlans({...f,mode:'publish'});
 const verify=f.storage.verify;f.storage.verify=async hash=>{const result=await verify(hash);await writeFile(f.raw,'changed concurrently');return result;};
 await assert.rejects(migratePlans({...f,mode:'evict'}),/changed/);assert.equal(await readFile(f.raw,'utf8'),'changed concurrently');await access(f.compressed);
});
test('a corrupted local source never overwrites its content-addressed cloud object',async t=>{
 const f=await fixture(t),{migratePlans}=await maintenance();await writeFile(f.raw,'corrupted local JSON');
 await assert.rejects(migratePlans({...f,mode:'publish'}),/checksum/);assert.equal(f.objects.size,0);await access(f.raw);await access(f.compressed);
});
test('a parent replaced with a symlink cannot redirect eviction outside its original root',{skip:process.platform==='win32'?'Requires POSIX symlinks':false},async t=>{
 const f=await fixture(t),{migratePlans}=await maintenance();await migratePlans({...f,mode:'publish'});
 const moved=join(f.root,'moved-plans'),verify=f.storage.verify;
 f.storage.verify=async hash=>{const result=await verify(hash);await rename(join(f.directory,'plans'),moved);await symlink(moved,join(f.directory,'plans'));return result;};
 await assert.rejects(migratePlans({...f,mode:'evict'}),/path changed/);await access(join(moved,f.hash+'.json'));await access(f.compressed);
});
