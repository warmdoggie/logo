import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';

test('private generation storage verifies original bytes and publishes a separate small preview',async()=>{
 let module;try{module=await import('./logo-generation-storage.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
 assert.ok(module?.createGenerationStorage,'generation results need verified private storage');
 const {createGenerationStorage}=module;
 const folder=await mkdtemp(join(tmpdir(),'logo-storage-')),objects=new Map();
 const client=async internal=>({
  async put(key,bytes){assert.equal(internal,true);objects.set(key,Buffer.from(bytes));},
  async get(key){return {content:objects.get(key)};},
  signatureUrl(key,{expires}){assert.equal(internal,false);assert.equal(expires,60);return 'https://heci-002.oss-cn-heyuan.aliyuncs.com/'+key+'?signed';}
 });
 try{
  const original=await sharp({create:{width:1800,height:1400,channels:3,background:'#eeeeee'}}).png().toBuffer(),file=join(folder,'original.png');await writeFile(file,original);
  const storage=createGenerationStorage({client}),id=randomUUID(),descriptor=await storage.publish(id,file);
  assert.ok(descriptor.original.startsWith('s7-logo/generations/v1/'+id+'/'));
  assert.deepEqual(objects.get(descriptor.original),original);
  const preview=await sharp(objects.get(descriptor.preview)).metadata();assert.equal(preview.format,'webp');assert.equal(preview.width,1200);assert.ok(preview.height<=1200);
  assert.ok((await storage.url(descriptor,true)).includes(descriptor.preview+'?signed'));
  await assert.rejects(storage.url({original:'frame/private.png',preview:descriptor.preview}),/Invalid/);
  const corrupted=createGenerationStorage({client:async()=>({put:async()=>{},get:async()=>({content:Buffer.from('corrupt')})})});
  await assert.rejects(corrupted.publish(randomUUID(),file),/checksum/i);
  assert.deepEqual(await readFile(file),original);
 }finally{await rm(folder,{recursive:true,force:true});}
});
