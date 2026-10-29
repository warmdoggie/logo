import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('offsite backups publish a completion manifest only after every object passes a full readback checksum',async()=>{
 let module;try{module=await import('./logo-scheduler-backup.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
 assert.ok(module?.uploadSchedulerBackup,'scheduler backups need verified offsite copies');
 const folder=await mkdtemp(join(tmpdir(),'scheduler-offsite-')),objects=new Map(),stamp='20261029T120000Z';
 try{
  await writeFile(join(folder,stamp+'.dump'),'database');await writeFile(join(folder,stamp+'.artifacts.tar'),'plans and images');
  const remote={async put(key,input){objects.set(key,Buffer.isBuffer(input)?input:await readFile(input));},async getStream(key){return {stream:Readable.from([objects.get(key)])};}};
  const result=await module.uploadSchedulerBackup({directory:folder,stamp,client:async internal=>{assert.equal(internal,true);return remote;}});
  assert.equal(result.manifest,'s7-logo/scheduler-backups/v1/20261029T120000Z/manifest.json');
  const manifest=JSON.parse(objects.get(result.manifest));assert.equal(manifest.files.length,2);assert.equal(manifest.files[0].bytes,8);assert.equal(manifest.files[0].sha256,'3549b0028b75d981cdda2e573e9cb49dedc200185876df299f912b79f69dabd8');
  for(const key of objects.keys())assert.ok(key.startsWith('s7-logo/scheduler-backups/v1/20261029T120000Z/'));
  objects.clear();remote.getStream=async()=>({stream:Readable.from(['corrupt'])});
  await assert.rejects(module.uploadSchedulerBackup({directory:folder,stamp,client:async()=>remote}),/checksum/i);
  assert.equal(objects.has(result.manifest),false);
 }finally{await rm(folder,{recursive:true,force:true});}
});
